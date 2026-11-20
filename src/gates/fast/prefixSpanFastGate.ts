/**
 * PrefixSpan-Backed Fast Gate
 *
 * The assessment (§10.4) found that the repository contained a real Rust/WASM
 * PrefixSpan miner that loaded successfully at runtime but was never connected to
 * arbitration: `AdaptiveInferenceEngine` was always constructed with `MockFastGate`.
 *
 * This gate closes that gap. It consumes mined frequent patterns and resolves each
 * pattern to a declared `InterventionCommand`, while remaining fully injectable so it
 * can be unit-tested without a worker or WASM binary.
 *
 * Determinism: patterns are ranked by (support desc, pattern length desc, lexicographic)
 * so the same history always produces the same decision.
 */

import { MacroInteraction } from '../../telemetry/events';
import { InterventionType } from '../../intervention/types';
import { FastGate, GateDecision } from './types';
import {
  PatternTarget,
  assertOutcomeDeclared,
  isPatternOutcomeMapping,
  resolvePatternTarget
} from './patternTarget';
import { OutcomeVocabulary } from '../contracts';
import { INTERVENTION_VOCABULARY } from '../../config/modelManifest';
import { defaultCollector } from '../../runtime/instrumentation';

/** Provenance identity of this gate implementation, reported on every match. */
const PREFIXSPAN_GATE_VERSION = 'prefixspan-wasm/1.0.0';

/** Shape of a mined frequent pattern, mirroring the Rust `PrefixSpanPattern`. */
export interface MinedPattern {
  pattern: string[];
  support: number;
  confidence: number;
}

/**
 * One mining call, bounds included.
 *
 * The bounds travel with the request rather than living only on the gate because the miner
 * is the only component that can stop its own search. A gate that filters an unbounded
 * result has already paid for it, which is the F-02 defect: the miner produced 2 452
 * patterns for nine short sequences and the gate then sorted all of them.
 */
export interface PatternMiningRequest {
  /**
   * One entry per observed sequence boundary, in chronological order. Support counts
   * sequences, so a sequence must not be repeated just to raise a pattern's support.
   */
  sequences: string[][];
  /** Minimum number of sequences a pattern must occur in. */
  minSupport: number;
  /** Hard bound: the longest pattern the miner may emit, in symbols. */
  maxPatternLength: number;
  /** Hard bound: the most patterns the miner may emit. */
  maxPatterns: number;
}

/**
 * Mines frequent patterns from a corpus of macro-symbol sequences.
 *
 * Sequences are `string[][]` (symbols only) because that is the wire shape the Rust
 * PrefixSpan implementation consumes; callers project interactions down to symbols.
 */
export type PatternMiner = (request: PatternMiningRequest) => Promise<MinedPattern[]>;

export type PatternIntervention = PatternTarget;

export interface PrefixSpanFastGateOptions {
  /**
   * Supplies the corpus of symbol sequences to mine. Each sequence is one session's
   * macro interactions in chronological order.
   */
  getSequences: () => string[][];
  /** Miner implementation. Defaults to the WASM gate client when available. */
  mine?: PatternMiner;
  /** Maps a mined pattern key ("A > B > C") to a declared intervention. */
  resolveIntervention?: (patternKey: string, pattern: MinedPattern) => PatternIntervention | null;
  /** Minimum support passed to the miner. Default 2. */
  minSupport?: number;
  /** Minimum confidence required to accept a mined pattern. Default 0. */
  minConfidence?: number;
  /** Maximum number of patterns considered per evaluation. Default 32. */
  maxPatterns?: number;
  /**
   * Longest pattern considered actionable, in symbols.
   *
   * The miner's cost grows with sequence length and alphabet repetition, so an unbounded
   * pattern length is a runtime hazard, not just a ranking preference. Patterns longer than
   * this are discarded before matching. Default 4.
   */
  maxPatternLength?: number;
  /**
   * Maximum number of sequences sent to the miner per evaluation.
   *
   * The mining corpus is the dominant cost input: mining cost measured at multi-second
   * p95 on a corpus of nine sequences with an unbounded repeated-symbol alphabet. The
   * corpus is therefore truncated to its most recent `maxCorpusSequences` entries, which
   * bounds the work without discarding the current session. Default 40.
   */
  maxCorpusSequences?: number;
  /**
   * Wall-clock deadline for one mining call, in milliseconds.
   *
   * The miner runs inside the runtime worker, which handles messages strictly serially, so
   * an over-running mine blocks every queued window. This deadline converts that into a
   * recorded, bounded failure rather than an unbounded stall. Default 1500 ms.
   */
  miningTimeoutMs?: number;
  /** Confidence reported on emitted decisions. Default 1.0. */
  defaultConfidence?: number;
  /** Version of the declared pattern set, reported on every match. */
  gateVersion?: string;
  /**
   * Vocabulary a declared pattern outcome must belong to.
   * Defaults to the intervention vocabulary, which the legacy pattern form names.
   */
  outcomeVocabulary?: OutcomeVocabulary;
  /**
   * Invoked once per evaluation with the outcome, so bounded-execution counters can be
   * published without this gate depending on the diagnostics layer.
   */
  onEvaluationOutcome?: (outcome: FastGateEvaluationOutcome) => void;
  /**
   * When true, the observed sequence must end with the pattern exactly (suffix match).
   *
   * Default false: a frequent pattern is matched when its symbols appear in order within
   * the recent sequence. Suffix matching was tried first and proved too strict in
   * practice, because consecutive macro actions in this testbed frequently straddle the
   * window stride and so never form an exact trailing run. Subsequence containment still
   * requires the pattern's ordering and all of its symbols.
   */
  suffixMatchOnly?: boolean;
}

/** How one Fast Gate evaluation ended, for bounded-execution accounting. */
export type FastGateEvaluationOutcome = 'executed' | 'no_corpus' | 'timed_out' | 'failed';

/**
 * Deterministic Fast Gate driven by frequent-sequence mining (PrefixSpan).
 */
export class PrefixSpanFastGate implements FastGate {
  private readonly options: Required<
    Pick<
      PrefixSpanFastGateOptions,
      | 'minSupport'
      | 'minConfidence'
      | 'maxPatterns'
      | 'maxPatternLength'
      | 'maxCorpusSequences'
      | 'miningTimeoutMs'
      | 'defaultConfidence'
      | 'suffixMatchOnly'
    >
  > & PrefixSpanFastGateOptions;

  private readonly vocabulary: OutcomeVocabulary;

  constructor(options: PrefixSpanFastGateOptions) {
    this.vocabulary = options.outcomeVocabulary ?? INTERVENTION_VOCABULARY;
    this.options = {
      ...options,
      minSupport: options.minSupport ?? 2,
      minConfidence: options.minConfidence ?? 0,
      maxPatterns: options.maxPatterns ?? 32,
      maxPatternLength: options.maxPatternLength ?? 4,
      maxCorpusSequences: options.maxCorpusSequences ?? 40,
      miningTimeoutMs: options.miningTimeoutMs ?? 1500,
      defaultConfidence: options.defaultConfidence ?? 1.0,
      suffixMatchOnly: options.suffixMatchOnly ?? false
    };
  }

  public async evaluate(sequence: MacroInteraction[]): Promise<GateDecision> {
    if (!sequence || sequence.length === 0) {
      return { matched: false, source: 'fast', reason: 'empty_sequence' };
    }

    const miner = this.options.mine ?? defaultMiner();
    if (!miner) {
      // No miner is available in this environment (no Worker, e.g. jsdom or SSR).
      // This is reported rather than silently returning a miss so a deployment that
      // forgot to supply a miner is visible.
      console.warn(
        '[PrefixSpanFastGate] No pattern miner available in this environment; ' +
          'the Fast Gate will always report a miss. Inject `mine` or run in a browser.'
      );
      this.reportOutcome('no_corpus');
      return { matched: false, source: 'fast', reason: 'miner_unavailable' };
    }

    const currentSymbols = sequence.map((interaction) => interaction.symbol);

    // Bound the corpus before mining. Mining cost is driven by corpus size and symbol
    // repetition, so the corpus is truncated to its most recent `maxCorpusSequences`
    // entries, which bounds the work without discarding the current session.
    //
    // The composition root frequently supplies the corpus and the evaluated sequence from
    // the same macro history. Appending unconditionally would then count that history twice
    // and double the support of every pattern in it: one occurrence would satisfy
    // `minSupport: 2` and the gate would "match" a pattern it has only seen once. The
    // duplicate is detected on the untruncated history, because truncation would hide the
    // equality while leaving the overlap in place.
    const history = this.options.getSequences();
    const observedIsAlreadyInCorpus = sameSymbols(history, currentSymbols);
    const boundedHistory =
      history.length > this.options.maxCorpusSequences
        ? history.slice(history.length - this.options.maxCorpusSequences)
        : history;

    const corpus = [...boundedHistory];
    if (!observedIsAlreadyInCorpus) {
      corpus.push(currentSymbols);
    }

    let patterns: MinedPattern[];
    let timedOut = false;
    try {
      const outcome = await this.runBounded(() =>
        miner({
          sequences: corpus,
          minSupport: this.options.minSupport,
          maxPatternLength: this.options.maxPatternLength,
          maxPatterns: this.options.maxPatterns
        })
      );
      patterns = outcome.patterns;
      timedOut = outcome.timedOut;
      // A deadline can expire and the mine still finish afterwards; either way the caller
      // must not treat a late result as a fresh evaluation.
      if (timedOut) {
        this.reportOutcome('timed_out');
        return { matched: false, source: 'fast', reason: 'mining_timeout' };
      }
    } catch (err) {
      console.error('[PrefixSpanFastGate] Pattern mining failed:', err);
      this.reportOutcome(timedOut ? 'timed_out' : 'failed');
      return { matched: false, source: 'fast', reason: 'mining_failed' };
    }

    if (!patterns || patterns.length === 0) {
      this.reportOutcome('executed');
      return { matched: false, source: 'fast', reason: 'no_frequent_pattern' };
    }

    const ranked = [...patterns].sort((a, b) => {
      if (b.support !== a.support) return b.support - a.support;
      if (b.pattern.length !== a.pattern.length) return b.pattern.length - a.pattern.length;
      return a.pattern.join(' > ').localeCompare(b.pattern.join(' > '));
    });

    const candidates = ranked
      // Discard over-long patterns before matching rather than after: an over-long pattern
      // is never actionable, and considering it wastes the bounded budget.
      .filter((pattern) => pattern.pattern && pattern.pattern.length > 0)
      .filter((pattern) => pattern.pattern.length <= this.options.maxPatternLength)
      .filter((pattern) => pattern.confidence >= this.options.minConfidence)
      .slice(0, this.options.maxPatterns);

    if (candidates.length === 0) {
      // Patterns were mined, but none survived the actionability filters (length, confidence,
      // count). That is a different miss from "nothing frequent enough existed".
      this.reportOutcome('executed');
      return { matched: false, source: 'fast', reason: 'no_actionable_pattern' };
    }

    // Distinguishes "a frequent pattern matched but the application declares no target for
    // it" from "no frequent pattern matched at all". Both are misses; only the first is a
    // configuration gap a researcher can act on.
    let matchedWithoutDeclaredTarget = false;

    for (const pattern of candidates) {
      if (!this.matches(currentSymbols, pattern.pattern)) continue;

      const patternKey = pattern.pattern.join(' > ');
      const resolver = this.options.resolveIntervention;
      const declaredTarget: PatternTarget | null = resolver
        ? resolver(patternKey, pattern)
        : { type: 'no_op' as InterventionType };

      // A mined pattern with no declared target is not an actionable match.
      if (!declaredTarget) {
        matchedWithoutDeclaredTarget = true;
        continue;
      }

      // A pattern is configuration: an outcome outside the gate's vocabulary is a
      // configuration error, reported with the pattern that declared it.
      if (isPatternOutcomeMapping(declaredTarget)) {
        assertOutcomeDeclared(
          this.vocabulary,
          declaredTarget.outcomeId,
          patternKey,
          'PrefixSpanFastGate'
        );
      }

      const resolved = resolvePatternTarget(declaredTarget, {
        patternKey,
        defaultConfidence: this.options.defaultConfidence,
        reason: `PrefixSpan match (support=${pattern.support}, confidence=${pattern.confidence.toFixed(2)}): ${patternKey}`
      });
      const outcomeIndex = this.vocabulary.outcomes.indexOf(resolved.outcomeId);
      const targetComponentId =
        resolved.targetComponentId ?? resolved.intervention?.targetComponentId;

      this.reportOutcome('executed');
      return {
        matched: true,
        source: 'fast',
        confidence: resolved.confidence,
        intervention: resolved.intervention,
        prediction: {
          outcomeId: resolved.outcomeId,
          vocabularyId: this.vocabulary.id,
          vocabularyVersion: this.vocabulary.version,
          outcomeIndex: outcomeIndex >= 0 ? outcomeIndex : undefined,
          confidence: resolved.confidence,
          matched: true,
          source: 'fast',
          mappingSource: 'fast_gate_pattern',
          target: targetComponentId ? { componentId: targetComponentId } : undefined
        },
        matchedPattern: pattern.pattern,
        gateVersion: this.options.gateVersion ?? PREFIXSPAN_GATE_VERSION
      };
    }

    this.reportOutcome('executed');
    return {
      matched: false,
      source: 'fast',
      reason: matchedWithoutDeclaredTarget ? 'no_declared_target' : 'no_matching_pattern'
    };
  }

  /** Reports how one evaluation ended, without letting a listener break the gate. */
  private reportOutcome(outcome: FastGateEvaluationOutcome): void {
    try {
      this.options.onEvaluationOutcome?.(outcome);
    } catch (err) {
      console.error('[PrefixSpanFastGate] Evaluation-outcome listener error:', err);
    }
  }

  /**
   * Runs the miner under a wall-clock deadline.
   *
   * The underlying WASM call cannot be cancelled — it runs to completion inside the worker —
   * so the deadline bounds when the *caller* stops waiting and records the outcome, which is
   * what keeps a queued evaluation from blocking the pipeline behind it.
   */
  private async runBounded(
    mine: () => Promise<MinedPattern[]>
  ): Promise<{ patterns: MinedPattern[]; timedOut: boolean }> {
    const work = defaultCollector.timeAsync('PrefixSpan mining', 'wasm', mine);

    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(new Error(`Mining deadline exceeded (${this.options.miningTimeoutMs} ms)`));
      }, this.options.miningTimeoutMs);
    });

    try {
      const patterns = await Promise.race([work, deadline]);
      return { patterns, timedOut: false };
    } catch (err) {
      // Swallow the eventual completion/rejection so an unattended promise cannot surface as
      // an unhandled rejection after the deadline has already been reported.
      void work.catch(() => undefined);
      if (expired) {
        console.warn(
          `[PrefixSpanFastGate] Mining exceeded its ${this.options.miningTimeoutMs} ms deadline; ` +
            'evaluation recorded as timed out. Bounded failure replaces the previous silent ' +
            'window drop (F-02).'
        );
        return { patterns: [], timedOut: true };
      }
      throw err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private matches(sequenceSymbols: string[], patternTokens: string[]): boolean {
    if (sequenceSymbols.length < patternTokens.length) return false;

    if (this.options.suffixMatchOnly) {
      const offset = sequenceSymbols.length - patternTokens.length;
      for (let i = 0; i < patternTokens.length; i++) {
        if (sequenceSymbols[offset + i] !== patternTokens[i]) return false;
      }
      return true;
    }

    // Subsequence containment: pattern tokens must appear in order.
    let cursor = 0;
    for (const token of sequenceSymbols) {
      if (token === patternTokens[cursor]) {
        cursor++;
        if (cursor === patternTokens.length) return true;
      }
    }
    return false;
  }
}

/**
 * Default miner: the real Rust/WASM PrefixSpan implementation, loaded directly.
 *
 * This deliberately does not delegate to `WasmGateClient`. That class is a main-thread RPC
 * client whose worker guard (`typeof Worker === 'undefined'`) is false in a worker scope and
 * whose request path uses `window.setTimeout` — so from inside the runtime worker it neither
 * started a worker nor could time a request. Loading the module directly removes the nested
 * worker hop and the `window` dependency.
 *
 * The import is lazy so this module stays importable in environments without WebAssembly.
 */

/**
 * True when the corpus, read end to end, is exactly the observed sequence.
 *
 * This is the composition the runtime uses: the corpus is the macro history split into
 * observation sequences, and the evaluated sequence is that same history. Flattening in
 * order is therefore exact, and a mismatch (a different history, a different order, or a
 * truncated corpus) means the observed sequence is genuinely a further sequence.
 */
function sameSymbols(corpus: string[][], observed: string[]): boolean {
  let index = 0;
  for (const sequence of corpus) {
    for (const symbol of sequence) {
      if (index >= observed.length || symbol !== observed[index]) return false;
      index++;
    }
  }
  return index === observed.length;
}

function defaultMiner(): PatternMiner | null {
  if (typeof WebAssembly === 'undefined') {
    return null;
  }

  let minerPromise: Promise<PatternMiner> | null = null;

  const getMiner = async (): Promise<PatternMiner> => {
    if (!minerPromise) {
      minerPromise = import('./prefixSpanMiner').then((mod) => mod.wasmPatternMiner);
    }
    return minerPromise;
  };

  return async (request) => {
    const miner = await getMiner();
    return miner(request);
  };
}

export function createPrefixSpanFastGate(
  options: PrefixSpanFastGateOptions
): PrefixSpanFastGate {
  return new PrefixSpanFastGate(options);
}
