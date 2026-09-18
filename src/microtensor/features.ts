/**
 * Pure Kinematic Feature Extractor & MicroTensor Vectorizer
 * Implements Layer B -> Layer C transformation ensuring strict mathematical parity
 * with model-preparation/src/preprocessing.py and model-preparation/src/config.yaml.
 */

import { BehaviourEvent } from '../telemetry/events';
import { getViewportDimensions } from '../telemetry/normalizer';
import {
  NUM_BEHAVIOURAL_FEATURES,
  MICROTENSOR_DIM,
  NORMALIZATION_CONFIG,
  NormalizationConfig,
  ModalitySupport,
  DEFAULT_MODALITY_SUPPORT
} from './schema';

export interface ComputeMicroTensorOptions {
  viewport?: { width: number; height: number };
  document?: { width: number; height: number };
  windowDurationMs?: number;
  modalitySupport?: ModalitySupport;
  scales?: Partial<NormalizationConfig>;
}

function clamp(val: number, min = 0.0, max = 1.0): number {
  if (Number.isNaN(val)) return min;
  return Math.min(Math.max(val, min), max);
}

function isValidDomTarget(target?: string): boolean {
  if (!target) return false;
  const s = target.trim();
  return Boolean(s && s !== '/' && s !== '/html' && s !== 'nan' && s !== 'None' && s !== '{}');
}

/**
 * Extracts a single 18-dimensional MicroTensor from a 500ms interaction window:
 * X_t (9 features) concatenated with binary Modality Mask Vector M in {0, 1}^9:
 * \widetilde{X}_t = [X_t \odot M, M] in R^18.
 * All outputs strictly bounded in [0, 1].
 */
export function computeWindowMicroTensor(
  events: BehaviourEvent[],
  options: ComputeMicroTensorOptions = {}
): Float32Array {
  const vp = options.viewport ?? getViewportDimensions();
  const doc = options.document ?? { width: 1920, height: 3000 };
  const windowDurationMs = options.windowDurationMs ?? 500.0;
  const modality = options.modalitySupport ?? DEFAULT_MODALITY_SUPPORT;

  if (vp.width <= 0 || vp.height <= 0) {
    throw new Error(`Invalid non-positive viewport dimensions: (${vp.width}, ${vp.height})`);
  }
  if (doc.width <= 0 || doc.height <= 0) {
    throw new Error(`Invalid non-positive document dimensions: (${doc.width}, ${doc.height})`);
  }

  // Normalization scaling denominators from config.yaml
  const scaleVelocity = options.scales?.mean_velocity_scale ?? NORMALIZATION_CONFIG.mean_velocity_scale;
  const scaleMaxVelocity = options.scales?.max_velocity_scale ?? NORMALIZATION_CONFIG.max_velocity_scale;
  const scaleAccel = options.scales?.mean_acceleration_scale ?? NORMALIZATION_CONFIG.mean_acceleration_scale;
  const scaleHesitation = options.scales?.hesitation_scale ?? NORMALIZATION_CONFIG.hesitation_scale;
  const scaleTrajectory = options.scales?.trajectory_scale ?? NORMALIZATION_CONFIG.trajectory_scale;
  const scaleScrollVelocity = options.scales?.scroll_velocity_scale ?? NORMALIZATION_CONFIG.scroll_velocity_scale;

  // 1. Initialize Kinematics (Natural zeros represent user physical rest)
  let meanVel = 0.0;
  let maxVel = 0.0;
  let meanAccel = 0.0;
  let hesitationCnt = 0.0;
  let totalTrajLen = 0.0;
  let dwellTimeMs = 0.0;
  let trajectoryEntropy = 0.0;
  let scrollDepthPct = 0.0;
  let scrollVel = 0.0;

  const mask = new Float32Array(NUM_BEHAVIOURAL_FEATURES);

  // 2. Modality Capability Assignment (ADR-001)
  if (modality.pointer) {
    mask[0] = 1.0; // meanVelocity
    mask[1] = 1.0; // maxVelocity
    mask[2] = 1.0; // meanAcceleration
    mask[3] = 1.0; // hesitationCount
    mask[4] = 1.0; // totalTrajectoryLength
    mask[6] = 1.0; // trajectoryEntropy
  }
  if (modality.dom) {
    mask[5] = 1.0; // dwellTimeMs
  }
  if (modality.scroll) {
    mask[7] = 1.0; // scrollDepthPercentage
    mask[8] = 1.0; // scrollVelocity
  }

  // 3. Pointer Kinematics Extraction (Conditioned on support and >= 2 coordinates)
  if (modality.pointer) {
    const pointerEvents = events.filter((ev) =>
      ['mousemove', 'mouseover', 'mousedown', 'mouseup', 'click'].includes(ev.type) &&
      ev.x != null &&
      ev.y != null
    );

    if (pointerEvents.length >= 2) {
      const distances: number[] = [];
      const dtList: number[] = [];
      const velocities: number[] = [];
      const dxPxList: number[] = [];
      const dyPxList: number[] = [];

      for (let i = 0; i < pointerEvents.length - 1; i++) {
        const evA = pointerEvents[i];
        const evB = pointerEvents[i + 1];

        const dxPx = (evB.x! - evA.x!) * vp.width;
        const dyPx = (evB.y! - evA.y!) * vp.height;
        const dt = Math.max(1.0, evB.timestamp - evA.timestamp);
        const dist = Math.sqrt(dxPx * dxPx + dyPx * dyPx);

        dxPxList.push(dxPx);
        dyPxList.push(dyPx);
        distances.push(dist);
        dtList.push(dt);

        const v = dist / dt;
        velocities.push(v);
      }

      totalTrajLen = distances.reduce((acc, d) => acc + d, 0);

      if (velocities.length > 0) {
        meanVel = velocities.reduce((acc, v) => acc + v, 0) / velocities.length;
        maxVel = Math.max(...velocities);
      }

      if (velocities.length >= 2) {
        let accelSum = 0.0;
        for (let i = 0; i < velocities.length - 1; i++) {
          const dtAcc = Math.max(1.0, dtList[i + 1]);
          const a = Math.abs(velocities[i + 1] - velocities[i]) / dtAcc;
          accelSum += a;
        }
        meanAccel = accelSum / (velocities.length - 1);
      }

      if (dxPxList.length >= 2) {
        const angles = dxPxList.map((dx, i) => Math.atan2(dyPxList[i], dx));
        let turns = 0;

        for (let i = 0; i < angles.length - 1; i++) {
          let diff = Math.abs(angles[i + 1] - angles[i]);
          if (diff > Math.PI) {
            diff = 2 * Math.PI - diff;
          }
          if (diff > Math.PI / 4.0) {
            turns += 1;
          }
        }
        hesitationCnt = turns;

        // Histogram of angles: 8 bins over [-pi, pi]
        const binCounts = new Array(8).fill(0);
        const binWidth = (2 * Math.PI) / 8;
        for (const angle of angles) {
          // Normalize angle to [0, 2*pi)
          const shifted = angle + Math.PI;
          let bin = Math.floor(shifted / binWidth);
          if (bin >= 8) bin = 7;
          if (bin < 0) bin = 0;
          binCounts[bin] += 1;
        }

        const totalAngles = angles.length;
        if (totalAngles > 0) {
          let entropy = 0.0;
          for (const count of binCounts) {
            if (count > 0) {
              const p = count / totalAngles;
              entropy -= p * Math.log2(p);
            }
          }
          // Normalize by log2(8) = 3.0
          trajectoryEntropy = entropy / 3.0;
        }
      }
    }
  }

  // 4. DOM Target Dwell Extraction
  if (modality.dom) {
    const dwellEvents = events.filter((ev) =>
      ev.type === 'mouseover' ||
      isValidDomTarget(ev.componentId) ||
      isValidDomTarget(ev.componentRole)
    );
    dwellTimeMs = Math.min(dwellEvents.length * 40.0, windowDurationMs);
  }

  // 5. Viewport Scroll Extraction
  if (modality.scroll) {
    const scrollEvents = events.filter((ev) => ev.type === 'scroll');
    const scrollCount = scrollEvents.length;

    scrollVel = (scrollCount * 100.0) / Math.max(windowDurationMs, 1.0);

    // If normalized scrollY is present on events, use the most recent scrollY
    const lastScrollWithY = [...scrollEvents].reverse().find((ev) => ev.scrollY !== undefined);
    if (lastScrollWithY && lastScrollWithY.scrollY !== undefined) {
      scrollDepthPct = lastScrollWithY.scrollY;
    } else {
      const maxScrollable = Math.max(doc.height - vp.height, 1.0);
      scrollDepthPct = Math.min(1.0, (scrollCount * 80.0) / maxScrollable);
    }
  }

  // 6. Assemble and Clamp 18-D MicroTensor: [X \odot M, M]
  const rawFeatures = [
    clamp(meanVel / scaleVelocity, 0.0, 1.0),
    clamp(maxVel / scaleMaxVelocity, 0.0, 1.0),
    clamp(meanAccel / scaleAccel, 0.0, 1.0),
    clamp(hesitationCnt / scaleHesitation, 0.0, 1.0),
    clamp(totalTrajLen / scaleTrajectory, 0.0, 1.0),
    clamp(dwellTimeMs / windowDurationMs, 0.0, 1.0),
    clamp(trajectoryEntropy, 0.0, 1.0),
    clamp(scrollDepthPct, 0.0, 1.0),
    clamp(scrollVel / scaleScrollVelocity, 0.0, 1.0)
  ];

  const microtensor = new Float32Array(MICROTENSOR_DIM);
  for (let i = 0; i < NUM_BEHAVIOURAL_FEATURES; i++) {
    microtensor[i] = rawFeatures[i] * mask[i]; // Feature value masked
    microtensor[NUM_BEHAVIOURAL_FEATURES + i] = mask[i]; // Binary modality mask
  }

  return microtensor;
}
