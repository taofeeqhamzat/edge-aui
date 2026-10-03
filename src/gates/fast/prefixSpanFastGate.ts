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
import {
  InterventionCommand,
  InterventionType,
  isInterventionType
} from '../../intervention/types';
import { FastGate, GateDecision } from './types';
import { defaultCollector } from '../../runtime/instrumentation';
import { getWallClockTimestamp } from '../../telemetry/normalizer';

/** Shape of a mined frequent pattern, mirroring the Rust `PrefixSpanPattern`. */
export interface MinedPattern {
  pattern: string[];
  support: number;
  confidence: number;
}

/**
 * Mines frequent patterns from a corpus of macro-symbol sequences.
 *
 * The corpus is `string[][]` (symbols only) because that is the wire shape the Rust
 * PrefixSpan implementation consumes; callers project interactions down to symbols.
 */
export type PatternMiner = (
  sequences: string[][],
  minSupport: number
) => Promise<MinedPattern[]>;

export type PatternIntervention = InterventionType | Partial<InterventionCommand>;

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

  constructor(options: PrefixSpanFastGateOptions) {
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
      return { matched: false, source: 'fast' };
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
      return { matched: false, source: 'fast' };
    }

    const currentSymbols = sequence.map((interaction) => interaction.symbol);

    // Bound the corpus before mining. Mining cost is driven by corpus size and symbol
    // repetition, and the corpus was previously the entire macro history; truncating to the
    // most recent entries bounds the work while keeping the current session, which is
    // appended below and therefore always participates in mining.
    const history = this.options.getSequences();
    const boundedHistory =
      history.length > this.options.maxCorpusSequences
        ? history.slice(history.length - this.options.maxCorpusSequences)
        : history;

    const corpus = [...boundedHistory];
    corpus.push(currentSymbols);

    let patterns: MinedPattern[];
    let timedOut = false;
    try {
      const outcome = await this.runBounded(() => miner(corpus, this.options.minSupport));
      patterns = outcome.patterns;
      timedOut = outcome.timedOut;
      // A deadline can expire and the mine still finish afterwards; either way the caller
      // must not treat a late result as a fresh evaluation.
      if (timedOut) {
        this.reportOutcome('timed_out');
        return { matched: false, source: 'fast' };
      }
    } catch (err) {
      console.error('[PrefixSpanFastGate] Pattern mining failed:', err);
      this.reportOutcome(timedOut ? 'timed_out' : 'failed');
      return { matched: false, source: 'fast' };
    }

    if (!patterns || patterns.length === 0) {
      this.reportOutcome('executed');
      return { matched: false, source: 'fast' };
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

    for (const pattern of candidates) {
      if (!this.matches(currentSymbols, pattern.pattern)) continue;

      const patternKey = pattern.pattern.join(' > ');
      const resolver = this.options.resolveIntervention;
      const resolvedIntervention = resolver
        ? resolver(patternKey, pattern)
        : { type: 'no_op' as InterventionType };

      // A mined pattern with no declared intervention is not an actionable match.
      if (!resolvedIntervention) continue;

      const intervention = this.createIntervention(resolvedIntervention, patternKey, pattern);

      this.reportOutcome('executed');
      return {
        matched: true,
        source: 'fast',
        confidence: intervention.confidence ?? this.options.defaultConfidence,
        intervention,
        matchedPattern: pattern.pattern
      };
    }

    this.reportOutcome('executed');
    return { matched: false, source: 'fast' };
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

  private createIntervention(
    target: PatternIntervention,
    patternKey: string,
    pattern: MinedPattern
  ): InterventionCommand {
    const now = getWallClockTimestamp();
    const reason = `PrefixSpan match (support=${pattern.support}, confidence=${pattern.confidence.toFixed(2)}): ${patternKey}`;

    if (typeof target === 'string' && isInterventionType(target)) {
      return {
        type: target,
        source: 'fast',
        mappingSource: 'fast_gate_pattern',
        confidence: this.options.defaultConfidence,
        issuedAt: now,
        reason
      };
    }

    const command = target as Partial<InterventionCommand>;
    return {
      type: command.type ?? 'no_op',
      source: 'fast',
      mappingSource: 'fast_gate_pattern',
      confidence: command.confidence ?? this.options.defaultConfidence,
      issuedAt: command.issuedAt ?? now,
      targetComponentId: command.targetComponentId,
      ttlMs: command.ttlMs,
      reason: command.reason ?? reason
    };
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

  return async (sequences, minSupport) => {
    const miner = await getMiner();
    return miner(sequences, minSupport);
  };
}

export function createPrefixSpanFastGate(
  options: PrefixSpanFastGateOptions
): PrefixSpanFastGate {
  return new PrefixSpanFastGate(options);
}
