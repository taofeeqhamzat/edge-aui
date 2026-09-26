use std::f64::consts::PI;
use crate::types::{
    CanonicalEvent, DocumentDimensions, MicroTensor, RawPointerPoint, VectorizerOptions,
    ViewportDimensions,
};

const NUM_DIRECTION_BINS: usize = 8;
const MIN_TIME_DELTA_MS: f64 = 1.0;

/// High-performance kinematic feature extraction from raw pointer coordinates.
pub fn extract_micro_features(
    points: &[RawPointerPoint],
    dwell_time_ms: f64,
    scroll_depth_percentage: f64,
    scroll_velocity: f64,
    current_timestamp: f64,
) -> MicroTensor {
    let count = points.len();

    if count < 2 {
        return MicroTensor {
            mean_velocity: 0.0,
            max_velocity: 0.0,
            mean_acceleration: 0.0,
            hesitation_count: 0,
            total_trajectory_length: 0.0,
            dwell_time_ms,
            scroll_depth_percentage,
            scroll_velocity,
            trajectory_entropy: 0.0,
            timestamp: current_timestamp,
        };
    }

    let mut total_dist = 0.0;
    let mut max_vel: f64 = 0.0;
    let mut velocities: Vec<f64> = Vec::with_capacity(count - 1);
    let mut accelerations: Vec<f64> = Vec::with_capacity(count.saturating_sub(2));
    let mut hesitation_counter: u32 = 0;
    let mut direction_bins = [0usize; NUM_DIRECTION_BINS];
    let mut total_angles = 0usize;

    for i in 1..count {
        let p_prev = &points[i - 1];
        let p_curr = &points[i];

        let dt = (p_curr.timestamp - p_prev.timestamp).max(MIN_TIME_DELTA_MS);
        let dx = p_curr.x - p_prev.x;
        let dy = p_curr.y - p_prev.y;
        let dist = (dx * dx + dy * dy).sqrt();

        total_dist += dist;
        let vel = dist / dt;
        velocities.push(vel);
        if vel > max_vel {
            max_vel = vel;
        }

        // Compute angle for trajectory entropy
        if dist > 0.0 {
            let mut angle = dy.atan2(dx); // [-PI, PI]
            if angle < 0.0 {
                angle += 2.0 * PI;
            }
            let bin = ((angle / (2.0 * PI)) * (NUM_DIRECTION_BINS as f64)).floor() as usize;
            let bin_clamped = bin.min(NUM_DIRECTION_BINS - 1);
            direction_bins[bin_clamped] += 1;
            total_angles += 1;
        }

        // Angular hesitation (> 45 degrees directional deviation)
        if i > 1 {
            let p_prev2 = &points[i - 2];
            let ux = p_prev.x - p_prev2.x;
            let uy = p_prev.y - p_prev2.y;
            let vx = dx;
            let vy = dy;

            let prev_vel = velocities[i - 2];
            let prev_dt = (p_prev.timestamp - p_prev2.timestamp).max(MIN_TIME_DELTA_MS);
            let accel = (vel - prev_vel) / prev_dt;
            accelerations.push(accel);

            let dot = ux * vx + uy * vy;
            let mag_u = (ux * ux + uy * uy).sqrt();
            let mag_v = (vx * vx + vy * vy).sqrt();

            if mag_u > 0.0 && mag_v > 0.0 {
                let cos_theta = (dot / (mag_u * mag_v)).clamp(-1.0, 1.0);
                let theta = cos_theta.acos(); // in radians
                if theta > (PI / 4.0) {
                    hesitation_counter += 1;
                }
            }
        }
    }

    let mean_vel = if !velocities.is_empty() {
        velocities.iter().sum::<f64>() / (velocities.len() as f64)
    } else {
        0.0
    };

    let mean_acc = if !accelerations.is_empty() {
        accelerations.iter().sum::<f64>() / (accelerations.len() as f64)
    } else {
        0.0
    };

    // Calculate Normalized Shannon Trajectory Entropy in [0, 1]
    let trajectory_entropy = if total_angles > 0 {
        let max_entropy = (NUM_DIRECTION_BINS as f64).log2();
        let entropy = direction_bins
            .iter()
            .filter(|&&count| count > 0)
            .map(|&c| {
                let p = (c as f64) / (total_angles as f64);
                -p * p.log2()
            })
            .sum::<f64>();
        (entropy / max_entropy).clamp(0.0, 1.0)
    } else {
        0.0
    };

    MicroTensor {
        mean_velocity: (mean_vel * 1000.0).round() / 1000.0,
        max_velocity: (max_vel * 1000.0).round() / 1000.0,
        mean_acceleration: (mean_acc * 10000.0).round() / 10000.0,
        hesitation_count: hesitation_counter,
        total_trajectory_length: (total_dist * 100.0).round() / 100.0,
        dwell_time_ms: (dwell_time_ms * 10.0).round() / 10.0,
        scroll_depth_percentage: (scroll_depth_percentage * 100.0).round() / 100.0,
        scroll_velocity: (scroll_velocity * 1000.0).round() / 1000.0,
        trajectory_entropy: (trajectory_entropy * 1000.0).round() / 1000.0,
        timestamp: current_timestamp,
    }
}

fn clamp_val(val: f64, min: f64, max: f64) -> f64 {
    if val.is_nan() {
        return min;
    }
    val.max(min).min(max)
}

fn is_valid_dom_target(target: Option<&str>) -> bool {
    match target {
        Some(t) => {
            let s = t.trim();
            !s.is_empty() && s != "/" && s != "/html" && s != "nan" && s != "None" && s != "{}"
        }
        None => false,
    }
}

/// Computes the exact 18-D MicroTensor from canonical behavioural events.
/// Matches `src/microtensor/features.ts` mathematically and behaviorally.
pub fn compute_canonical_micro_tensor(
    events: &[CanonicalEvent],
    options: Option<VectorizerOptions>,
) -> Result<[f32; 18], String> {
    let opts = options.unwrap_or_default();
    let vp = opts.viewport.unwrap_or(ViewportDimensions {
        width: 1920.0,
        height: 1080.0,
    });
    if vp.width <= 0.0 || vp.height <= 0.0 {
        return Err(format!(
            "Invalid non-positive viewport dimensions: ({}, {})",
            vp.width, vp.height
        ));
    }
    let doc = opts.document.unwrap_or(DocumentDimensions {
        width: 1920.0,
        height: 3000.0,
        scrollable_width: None,
        scrollable_height: None,
    });
    if doc.width <= 0.0 || doc.height <= 0.0 {
        return Err(format!(
            "Invalid non-positive document dimensions: ({}, {})",
            doc.width, doc.height
        ));
    }
    let window_duration_ms = opts.window_duration_ms.unwrap_or(500.0);
    if window_duration_ms <= 0.0 {
        return Err(format!(
            "Invalid non-positive window duration: {}",
            window_duration_ms
        ));
    }
    let modality = opts.modality_support.unwrap_or_default();
    let scales = opts.scales.unwrap_or_default();

    let scale_velocity = scales.mean_velocity_scale.unwrap_or(10.0);
    let scale_max_velocity = scales.max_velocity_scale.unwrap_or(10.0);
    let scale_accel = scales.mean_acceleration_scale.unwrap_or(1.0);
    let scale_hesitation = scales.hesitation_scale.unwrap_or(25.0);
    let scale_trajectory = scales.trajectory_scale.unwrap_or(2000.0);
    let scale_scroll_velocity = scales.scroll_velocity_scale.unwrap_or(5.0);

    let mut mean_vel = 0.0f64;
    let mut max_vel = 0.0f64;
    let mut mean_accel = 0.0f64;
    let mut hesitation_cnt = 0.0f64;
    let mut total_traj_len = 0.0f64;
    let mut dwell_time_ms = 0.0f64;
    let mut trajectory_entropy = 0.0f64;
    let mut scroll_depth_pct = 0.0f64;
    let mut scroll_vel = 0.0f64;

    let mut mask = [0.0f32; 9];
    if modality.pointer {
        mask[0] = 1.0;
        mask[1] = 1.0;
        mask[2] = 1.0;
        mask[3] = 1.0;
        mask[4] = 1.0;
        mask[6] = 1.0;
    }
    if modality.dom {
        mask[5] = 1.0;
    }
    if modality.scroll {
        mask[7] = 1.0;
        mask[8] = 1.0;
    }

    if modality.pointer {
        let pointer_types = ["mousemove", "mouseover", "mousedown", "mouseup", "click"];
        let pointer_events: Vec<&CanonicalEvent> = events
            .iter()
            .filter(|ev| {
                pointer_types.contains(&ev.event_type.as_str())
                    && ev.x.is_some()
                    && ev.y.is_some()
            })
            .collect();

        if pointer_events.len() >= 2 {
            let mut distances: Vec<f64> = Vec::with_capacity(pointer_events.len() - 1);
            let mut dt_list: Vec<f64> = Vec::with_capacity(pointer_events.len() - 1);
            let mut velocities: Vec<f64> = Vec::with_capacity(pointer_events.len() - 1);
            let mut dx_px_list: Vec<f64> = Vec::with_capacity(pointer_events.len() - 1);
            let mut dy_px_list: Vec<f64> = Vec::with_capacity(pointer_events.len() - 1);

            for i in 0..pointer_events.len() - 1 {
                let ev_a = pointer_events[i];
                let ev_b = pointer_events[i + 1];

                let dx_px = (ev_b.x.unwrap() - ev_a.x.unwrap()) * vp.width;
                let dy_px = (ev_b.y.unwrap() - ev_a.y.unwrap()) * vp.height;
                let dt = (ev_b.timestamp - ev_a.timestamp).max(1.0);
                let dist = (dx_px * dx_px + dy_px * dy_px).sqrt();

                dx_px_list.push(dx_px);
                dy_px_list.push(dy_px);
                distances.push(dist);
                dt_list.push(dt);

                let v = dist / dt;
                velocities.push(v);
            }

            total_traj_len = distances.iter().sum::<f64>();

            if !velocities.is_empty() {
                mean_vel = velocities.iter().sum::<f64>() / (velocities.len() as f64);
                max_vel = velocities.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            }

            if velocities.len() >= 2 {
                let mut accel_sum = 0.0f64;
                for i in 0..velocities.len() - 1 {
                    let dt_acc = dt_list[i + 1].max(1.0);
                    let a = (velocities[i + 1] - velocities[i]).abs() / dt_acc;
                    accel_sum += a;
                }
                mean_accel = accel_sum / ((velocities.len() - 1) as f64);
            }

            if dx_px_list.len() >= 2 {
                let angles: Vec<f64> = dx_px_list
                    .iter()
                    .zip(dy_px_list.iter())
                    .map(|(&dx, &dy)| dy.atan2(dx))
                    .collect();

                let mut turns = 0.0f64;
                for i in 0..angles.len() - 1 {
                    let mut diff = (angles[i + 1] - angles[i]).abs();
                    if diff > PI {
                        diff = 2.0 * PI - diff;
                    }
                    if diff > PI / 4.0 {
                        turns += 1.0;
                    }
                }
                hesitation_cnt = turns;

                let mut bin_counts = [0usize; 8];
                let bin_width = (2.0 * PI) / 8.0;
                for &angle in &angles {
                    let shifted = angle + PI;
                    let mut bin = (shifted / bin_width).floor() as isize;
                    if bin >= 8 {
                        bin = 7;
                    }
                    if bin < 0 {
                        bin = 0;
                    }
                    bin_counts[bin as usize] += 1;
                }

                let total_angles = angles.len();
                if total_angles > 0 {
                    let mut entropy = 0.0f64;
                    for &count in &bin_counts {
                        if count > 0 {
                            let p = (count as f64) / (total_angles as f64);
                            entropy -= p * p.log2();
                        }
                    }
                    trajectory_entropy = entropy / 3.0;
                }
            }
        }
    }

    if modality.dom {
        let dwell_events_count = events
            .iter()
            .filter(|ev| {
                ev.event_type == "mouseover"
                    || is_valid_dom_target(ev.component_id.as_deref())
                    || is_valid_dom_target(ev.component_role.as_deref())
            })
            .count();
        dwell_time_ms = ((dwell_events_count as f64) * 40.0).min(window_duration_ms);
    }

    if modality.scroll {
        let scroll_count = events
            .iter()
            .filter(|ev| ev.event_type == "scroll" || ev.event_type == "wheel")
            .count();
        scroll_vel = ((scroll_count as f64) * 100.0) / window_duration_ms.max(1.0);
        let max_scrollable = (doc.height - vp.height).max(1.0);
        scroll_depth_pct = (1.0f64).min(((scroll_count as f64) * 80.0) / max_scrollable);
    }

    let raw_features = [
        clamp_val(mean_vel / scale_velocity, 0.0, 1.0),
        clamp_val(max_vel / scale_max_velocity, 0.0, 1.0),
        clamp_val(mean_accel / scale_accel, 0.0, 1.0),
        clamp_val(hesitation_cnt / scale_hesitation, 0.0, 1.0),
        clamp_val(total_traj_len / scale_trajectory, 0.0, 1.0),
        clamp_val(dwell_time_ms / window_duration_ms, 0.0, 1.0),
        clamp_val(trajectory_entropy, 0.0, 1.0),
        clamp_val(scroll_depth_pct, 0.0, 1.0),
        clamp_val(scroll_vel / scale_scroll_velocity, 0.0, 1.0),
    ];

    let mut output = [0.0f32; 18];
    for i in 0..9 {
        output[i] = (raw_features[i] as f32) * mask[i];
        output[9 + i] = mask[i];
    }

    Ok(output)
}
