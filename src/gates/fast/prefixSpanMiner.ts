/**
 * PrefixSpan Pattern Miner — the single WASM boundary in the framework
 *
 * Runs the Rust/WASM PrefixSpan miner in whatever scope calls it (main thread or a dedicated
 * worker) with no nested-worker hop and no dependency on `window`.
 *
 * The assessment (§10.4) found the WASM Fast Gate loaded successfully but was never wired to
 * arbitration. The first wiring attempt reused the former `WasmGateClient`, a *main-thread*
 * RPC client, which failed silently from inside the runtime worker for two reasons:
 *
 *   1. It guarded on `typeof Worker === 'undefined'`, but `Worker` is also undefined inside a
 *      dedicated worker, so it took the "workers unsupported" branch and never started one.
 *   2. Its request path used `window.setTimeout`, and `window` does not exist in a worker.
 *
 * Loading the module directly removes both failure modes, and this module is now the only
 * place that touches the WASM vectorizer.
 */

import initWasm, {
  mine_macro_patterns,
  get_wasm_gate_version
} from '../../../wasm-vectorizer/pkg/wasm_vectorizer.js';
import type { PatternMiner, MinedPattern } from './prefixSpanFastGate';

let initPromise: Promise<void> | null = null;
let wasmUnavailableReason: string | null = null;

/** True when this environment can host the WASM module at all. */
export function isWasmAvailable(): boolean {
  return typeof WebAssembly !== 'undefined';
}

/**
 * Initialises the WASM module once per scope. Subsequent calls reuse the same instance.
 * Returns null and records a reason when the module cannot be initialised.
 */
export async function ensurePrefixSpanWasm(): Promise<string | null> {
  if (!isWasmAvailable()) {
    wasmUnavailableReason = 'WebAssembly is not available in this environment';
    return null;
  }

  if (!initPromise) {
    initPromise = (async () => {
      await initWasm();
    })().catch((err) => {
      initPromise = null;
      wasmUnavailableReason = err instanceof Error ? err.message : String(err);
      throw err;
    });
  }

  try {
    await initPromise;
    return get_wasm_gate_version();
  } catch {
    return null;
  }
}

/** Why the last initialisation attempt failed, if it did. */
export function getWasmUnavailableReason(): string | null {
  return wasmUnavailableReason;
}

/**
 * Mines frequent macro-interaction patterns with the real PrefixSpan implementation.
 * Returns null when the module is unavailable, so callers can distinguish "no frequent
 * patterns" from "no miner".
 */
export async function minePatternsDirect(
  sequences: string[][],
  minSupport: number
): Promise<MinedPattern[] | null> {
  const version = await ensurePrefixSpanWasm();
  if (version === null) {
    return null;
  }

  const raw = mine_macro_patterns(sequences, minSupport) as
    | { pattern: string[]; support: number; confidence: number }[]
    | null;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((entry) => ({
    pattern: Array.isArray(entry.pattern) ? entry.pattern : [],
    support: Number(entry.support) || 0,
    confidence: Number(entry.confidence) || 0
  }));
}

/** A `PatternMiner` bound to the real WASM implementation. */
export const wasmPatternMiner: PatternMiner = async (sequences, minSupport) => {
  const mined = await minePatternsDirect(sequences, minSupport);
  // A missing miner is a real failure, not an empty result; surface it.
  if (mined === null) {
    throw new Error(
      `PrefixSpan WASM module unavailable: ${wasmUnavailableReason ?? 'unknown reason'}`
    );
  }
  return mined;
};
