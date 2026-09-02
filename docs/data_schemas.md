# Data Telemetry and Shape Specifications

To ensure seamless message passing between the TypeScript Main Thread, the Rust WASM module, and the ONNX worker, data structures must be strictly typed.

## 1. Raw Interaction Payload (Main Thread -> WASM)

The system captures user activity as a structured interaction event containing the target component, action type, timestamp, and contextual vector[cite: 18].

```typescript
interface InteractionEvent {
  timestamp: number;
  eventType: "click" | "mousemove" | "scroll" | "hover";
  targetId: string;
  coordinates: [number, number]; // [x, y] normalized to viewport [0, 1]
  scrollDepth: number; // Normalized [0, 1]
  dwellTimeMs: number;
}
```

## 2. The MicroTensor (WASM -> ONNX)

Because storing continuous micro-interactions causes memory overflow, the WASM vectorizer converts the 500ms batched events into a fixed-length summary vector[cite: 18].

```json
{
  "session_id": "sess_89a12c",
  "window_index": 4,
  "duration_ms": 500,
  "macro_sequence": ["nav_menu_open", "filter_price_hover"],
  "micro_tensor": {
    "mean_cursor_velocity": 1.42,
    "trajectory_entropy": 0.38,
    "hesitation_count": 2,
    "scroll_delta_px": 0,
    "hover_dwell_time_ms": 310
  }
}
```
