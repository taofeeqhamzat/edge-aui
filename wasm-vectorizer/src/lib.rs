mod kinematics;
mod prefix_span;
mod types;

use wasm_bindgen::prelude::*;
use types::{InteractionPacket, MacroEvent, RawPointerPoint};

#[wasm_bindgen]
pub fn get_wasm_gate_version() -> String {
    "Edge-AUI-Deterministic-Gate-v0.1.0".to_string()
}

/// Computes dense MicroTensor features from raw pointer coordinates.
#[wasm_bindgen]
pub fn extract_micro_tensor(
    points_val: JsValue,
    dwell_time_ms: f64,
    scroll_depth_percentage: f64,
    scroll_velocity: f64,
    current_timestamp: f64,
) -> Result<JsValue, JsValue> {
    let points: Vec<RawPointerPoint> = serde_wasm_bindgen::from_value(points_val)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize points: {}", e)))?;

    let tensor = kinematics::extract_micro_features(
        &points,
        dwell_time_ms,
        scroll_depth_percentage,
        scroll_velocity,
        current_timestamp,
    );

    serde_wasm_bindgen::to_value(&tensor)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize MicroTensor: {}", e)))
}

/// Takes a raw interaction batch (points + macro queue) and converts it into a completed InteractionPacket.
#[wasm_bindgen]
pub fn process_interaction_batch(
    session_id: String,
    window_duration_ms: f64,
    points_val: JsValue,
    macro_events_val: JsValue,
    dwell_time_ms: f64,
    scroll_depth_percentage: f64,
    scroll_velocity: f64,
    timestamp: f64,
) -> Result<JsValue, JsValue> {
    let points: Vec<RawPointerPoint> = serde_wasm_bindgen::from_value(points_val)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize points: {}", e)))?;

    let macro_events: Vec<MacroEvent> = serde_wasm_bindgen::from_value(macro_events_val)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize macro_events: {}", e)))?;

    let tensor = kinematics::extract_micro_features(
        &points,
        dwell_time_ms,
        scroll_depth_percentage,
        scroll_velocity,
        timestamp,
    );

    let packet = InteractionPacket {
        session_id,
        window_duration_ms,
        macro_events,
        features: tensor,
    };

    serde_wasm_bindgen::to_value(&packet)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize InteractionPacket: {}", e)))
}

/// Deterministic Gate: Mines frequent macro-interaction sequences using PrefixSpan.
#[wasm_bindgen]
pub fn mine_macro_patterns(
    sequences_val: JsValue,
    min_support: usize,
) -> Result<JsValue, JsValue> {
    let sequences: Vec<Vec<String>> = serde_wasm_bindgen::from_value(sequences_val)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize sequences: {}", e)))?;

    let patterns = prefix_span::mine_prefix_span(&sequences, min_support);

    serde_wasm_bindgen::to_value(&patterns)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize PrefixSpan patterns: {}", e)))
}

/// Extracts the 18-D MicroTensor from canonical behavioural events.
///
/// NOTE: Parity Test Oracle Only (ADR-001 Option A, accepted).
/// Per ADR-001, the live runtime pipeline executes vectorisation in TypeScript
/// (`src/microtensor/features.ts`) where it completes in ~8.26 µs (consuming 0.003%
/// of the 250ms stride) without JS-to-WASM memory serialization. This WASM function
/// is retained as an offline parity reference and test oracle. PrefixSpan pattern
/// mining below remains the live production WASM path (ADR-002).
///
/// Returns Float32Array of length 18: 9 normalized continuous kinematic features + 9 binary modality masks.
#[wasm_bindgen]
pub fn vectorize_canonical_events(
    events_val: JsValue,
    options_val: JsValue,
) -> Result<Vec<f32>, JsValue> {
    if events_val.is_null() || events_val.is_undefined() {
        return Err(js_sys::Error::new("events argument cannot be null or undefined").into());
    }

    let events: Vec<types::CanonicalEvent> = serde_wasm_bindgen::from_value(events_val)
        .map_err(|e| js_sys::Error::new(&format!("Failed to deserialize canonical events: {}", e)))?;

    let options: Option<types::VectorizerOptions> = if options_val.is_null() || options_val.is_undefined() {
        None
    } else {
        Some(serde_wasm_bindgen::from_value(options_val)
            .map_err(|e| js_sys::Error::new(&format!("Failed to deserialize options: {}", e)))?)
    };

    let tensor = kinematics::compute_canonical_micro_tensor(&events, options)
        .map_err(|e| js_sys::Error::new(&e))?;

    Ok(tensor.to_vec())
}

/// Detailed canonical vectorisation returning features, modality mask, and modality support object.
#[wasm_bindgen]
pub fn vectorize_canonical_window(
    events_val: JsValue,
    options_val: JsValue,
) -> Result<JsValue, JsValue> {
    if events_val.is_null() || events_val.is_undefined() {
        return Err(js_sys::Error::new("events argument cannot be null or undefined").into());
    }

    let events: Vec<types::CanonicalEvent> = serde_wasm_bindgen::from_value(events_val)
        .map_err(|e| js_sys::Error::new(&format!("Failed to deserialize canonical events: {}", e)))?;

    let options: Option<types::VectorizerOptions> = if options_val.is_null() || options_val.is_undefined() {
        None
    } else {
        Some(serde_wasm_bindgen::from_value(options_val)
            .map_err(|e| js_sys::Error::new(&format!("Failed to deserialize options: {}", e)))?)
    };

    let modality_support = options
        .as_ref()
        .and_then(|o| o.modality_support.clone())
        .unwrap_or_default();

    let tensor_arr = kinematics::compute_canonical_micro_tensor(&events, options)
        .map_err(|e| js_sys::Error::new(&e))?;

    let tensor = tensor_arr.to_vec();
    let features = tensor[0..9].to_vec();
    let modality_mask = tensor[9..18].to_vec();

    let detailed = types::VectorizedWindowDetailed {
        tensor,
        features,
        modality_mask,
        modality_support,
    };

    serde_wasm_bindgen::to_value(&detailed)
        .map_err(|e| js_sys::Error::new(&format!("Failed to serialize detailed result: {}", e)).into())
}
