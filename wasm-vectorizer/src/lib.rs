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
