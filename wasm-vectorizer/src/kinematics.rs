use std::f64::consts::PI;
use crate::types::{MicroTensor, RawPointerPoint};

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
