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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportDimensions {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDimensions {
    pub width: f64,
    pub height: f64,
    pub scrollable_width: Option<f64>,
    pub scrollable_height: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModalitySupport {
    #[serde(default = "default_true")]
    pub pointer: bool,
    #[serde(default = "default_true")]
    pub dom: bool,
    #[serde(default = "default_true")]
    pub scroll: bool,
}

fn default_true() -> bool {
    true
}

impl Default for ModalitySupport {
    fn default() -> Self {
        Self {
            pointer: true,
            dom: true,
            scroll: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationScales {
    pub mean_velocity_scale: Option<f64>,
    pub max_velocity_scale: Option<f64>,
    pub mean_acceleration_scale: Option<f64>,
    pub hesitation_scale: Option<f64>,
    pub trajectory_scale: Option<f64>,
    pub scroll_velocity_scale: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VectorizerOptions {
    pub viewport: Option<ViewportDimensions>,
    pub document: Option<DocumentDimensions>,
    pub window_duration_ms: Option<f64>,
    pub modality_support: Option<ModalitySupport>,
    pub scales: Option<NormalizationScales>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalEvent {
    pub timestamp: f64,
    #[serde(rename = "type")]
    pub event_type: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub scroll_x: Option<f64>,
    pub scroll_y: Option<f64>,
    pub scroll_top_px: Option<f64>,
    pub component_id: Option<String>,
    pub component_role: Option<String>,
    pub route: Option<String>,
    pub action: Option<String>,
    pub task_id: Option<String>,
    pub task_step_id: Option<String>,
    pub target_tag: Option<String>,
    pub viewport: Option<ViewportDimensions>,
    pub document: Option<DocumentDimensions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorizedWindowDetailed {
    pub tensor: Vec<f32>,
    pub features: Vec<f32>,
    pub modality_mask: Vec<f32>,
    pub modality_support: ModalitySupport,
}
