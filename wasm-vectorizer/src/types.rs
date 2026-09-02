use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawPointerPoint {
    pub x: f64,
    pub y: f64,
    pub timestamp: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(rename = "targetId")]
    pub target_id: String,
    pub timestamp: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicroTensor {
    pub mean_velocity: f64,
    pub max_velocity: f64,
    pub mean_acceleration: f64,
    pub hesitation_count: u32,
    pub total_trajectory_length: f64,
    pub dwell_time_ms: f64,
    pub scroll_depth_percentage: f64,
    pub scroll_velocity: f64,
    pub trajectory_entropy: f64,
    pub timestamp: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionPacket {
    pub session_id: String,
    pub window_duration_ms: f64,
    pub macro_events: Vec<MacroEvent>,
    pub features: MicroTensor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefixSpanPattern {
    pub pattern: Vec<String>,
    pub support: usize,
    pub confidence: f64,
}
