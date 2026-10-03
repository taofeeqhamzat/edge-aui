/* tslint:disable */
/* eslint-disable */

/**
 * Computes dense MicroTensor features from raw pointer coordinates.
 */
export function extract_micro_tensor(points_val: any, dwell_time_ms: number, scroll_depth_percentage: number, scroll_velocity: number, current_timestamp: number): any;

export function get_wasm_gate_version(): string;

/**
 * Deterministic Gate: Mines frequent macro-interaction sequences using PrefixSpan.
 */
export function mine_macro_patterns(sequences_val: any, min_support: number): any;

/**
 * Takes a raw interaction batch (points + macro queue) and converts it into a completed InteractionPacket.
 */
export function process_interaction_batch(session_id: string, window_duration_ms: number, points_val: any, macro_events_val: any, dwell_time_ms: number, scroll_depth_percentage: number, scroll_velocity: number, timestamp: number): any;

/**
 * Extracts the 18-D MicroTensor from canonical behavioural events.
 *
 * NOTE: Parity Test Oracle Only (ADR-001 Option A, accepted).
 * Per ADR-001, the live runtime pipeline executes vectorisation in TypeScript
 * (`src/microtensor/features.ts`) where it completes in ~8.26 µs (consuming 0.003%
 * of the 250ms stride) without JS-to-WASM memory serialization. This WASM function
 * is retained as an offline parity reference and test oracle. PrefixSpan pattern
 * mining below remains the live production WASM path (ADR-002).
 *
 * Returns Float32Array of length 18: 9 normalized continuous kinematic features + 9 binary modality masks.
 */
export function vectorize_canonical_events(events_val: any, options_val: any): Float32Array;

/**
 * Detailed canonical vectorisation returning features, modality mask, and modality support object.
 */
export function vectorize_canonical_window(events_val: any, options_val: any): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly extract_micro_tensor: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly get_wasm_gate_version: (a: number) => void;
    readonly mine_macro_patterns: (a: number, b: number, c: number) => void;
    readonly process_interaction_batch: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly vectorize_canonical_events: (a: number, b: number, c: number) => void;
    readonly vectorize_canonical_window: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
