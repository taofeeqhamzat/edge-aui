/**
 * ClientBehaviorTracker: High-performance, client-side Behavioral Observer
 * Captures raw interaction kinematics, computes feature vectors, and manages
 * an ephemeral sliding window buffer every 500ms with immediate memory purge.
 */

import type {
  InteractionPacket,
  MacroEvent,
  MicroTensor,
  RawPointerPoint
} from '../../types/telemetry.js';

export interface TrackerOptions {
  sessionId?: string;
  bufferWindowMs?: number;
  trackableSelector?: string;
  onFlush: (packet: InteractionPacket) => void;
}

export class ClientBehaviorTracker {
  private pointBuffer: RawPointerPoint[] = [];
  private macroQueue: MacroEvent[] = [];
  private isThrottled: boolean = false;
  private lastScrollY: number = typeof window !== 'undefined' ? window.scrollY : 0;
  private lastScrollTime: number = typeof performance !== 'undefined' ? performance.now() : 0;
  private maxScrollDepth: number = 0;
  private lastScrollVelocity: number = 0;
  private activeHoverStart: number | null = null;
  private totalDwellAccumulator: number = 0;
  private flushTimer: number | null = null;
  private isRunning: boolean = false;

  private readonly sessionId: string;
  private readonly bufferWindowMs: number;
  private readonly trackableSelector: string;
  private readonly onFlushCallback: (packet: InteractionPacket) => void;

  // Bound event listeners for cleanup
  private boundPointerMove: ((e: PointerEvent) => void) | null = null;
  private boundPointerOver: ((e: MouseEvent) => void) | null = null;
  private boundPointerOut: ((e: MouseEvent) => void) | null = null;
  private boundClick: ((e: MouseEvent) => void) | null = null;
  private boundScroll: (() => void) | null = null;

  constructor(options: TrackerOptions) {
    this.sessionId = options.sessionId ?? `sess_${Math.random().toString(36).substring(2, 10)}`;
    this.bufferWindowMs = options.bufferWindowMs ?? 500;
    this.trackableSelector = options.trackableSelector ?? '[data-trackable]';
    this.onFlushCallback = options.onFlush;

    this.start();
  }

  public start(): void {
    if (this.isRunning || typeof window === 'undefined') return;
    this.isRunning = true;
    this.initListeners();
    this.startBufferingCycle();
  }

  private initListeners(): void {
    // 1. Cursor Trajectory Tracking (Throttled via requestAnimationFrame for 60 FPS)
    this.boundPointerMove = (event: PointerEvent) => {
      if (!this.isThrottled) {
        this.isThrottled = true;
        requestAnimationFrame(() => {
          this.pointBuffer.push({
            x: event.clientX,
            y: event.clientY,
            timestamp: performance.now()
          });
          this.isThrottled = false;
        });
      }
    };
    window.addEventListener('pointermove', this.boundPointerMove, { passive: true });

    // 2. Temporal & Attention Markers (DOM Hover In/Out on trackable elements)
    this.boundPointerOver = (event: MouseEvent) => {
      const target = (event.target as HTMLElement)?.closest?.(this.trackableSelector) as HTMLElement | null;
      if (target) {
        this.activeHoverStart = performance.now();
      }
    };
    document.body.addEventListener('pointerover', this.boundPointerOver, { passive: true });

    this.boundPointerOut = (event: MouseEvent) => {
      const target = (event.target as HTMLElement)?.closest?.(this.trackableSelector) as HTMLElement | null;
      if (target && this.activeHoverStart !== null) {
        this.totalDwellAccumulator += performance.now() - this.activeHoverStart;
        this.activeHoverStart = null;
      }
    };
    document.body.addEventListener('pointerout', this.boundPointerOut, { passive: true });

    // 3. Macro-Interactions (Discrete clicks with component target identification)
    this.boundClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const trackable = target?.closest?.(this.trackableSelector) as HTMLElement | null;
      const targetId =
        trackable?.getAttribute('data-trackable') ||
        target?.id ||
        (trackable?.id ? trackable.id : null) ||
        (typeof target?.className === 'string' && target.className.trim() ? target.className.trim().split(' ')[0] : null) ||
        target?.tagName?.toLowerCase() ||
        'anonymous_node';

      this.macroQueue.push({
        type: 'click',
        targetId,
        timestamp: performance.now()
      });
    };
    window.addEventListener('click', this.boundClick, { passive: true });

    // 4. Viewport Kinematics & Scroll Depth
    this.boundScroll = () => {
      const now = performance.now();
      const currentScrollY = window.scrollY;
      const docHeight = Math.max(1, document.documentElement.scrollHeight);
      const vpHeight = window.innerHeight;

      // Calculate relative depth [0, 100]%
      const depth = Math.min(100, Math.round(((currentScrollY + vpHeight) / docHeight) * 100));
      if (depth > this.maxScrollDepth) {
        this.maxScrollDepth = depth;
      }

      const dt = Math.max(1, now - this.lastScrollTime);
      const dy = Math.abs(currentScrollY - this.lastScrollY);
      this.lastScrollVelocity = dy / dt;

      this.lastScrollY = currentScrollY;
      this.lastScrollTime = now;
    };
    window.addEventListener('scroll', this.boundScroll, { passive: true });
  }

  /**
   * Computes the MicroTensor feature vector from raw points in JS (Main-thread fallback).
   */
  public extractMicroFeatures(): MicroTensor {
    const points = this.pointBuffer;
    const count = points.length;

    // Check if hover is currently active to accumulate ongoing dwell time
    let currentDwell = this.totalDwellAccumulator;
    if (this.activeHoverStart !== null) {
      currentDwell += performance.now() - this.activeHoverStart;
    }

    if (count < 2) {
      return {
        meanVelocity: 0,
        maxVelocity: 0,
        meanAcceleration: 0,
        hesitationCount: 0,
        totalTrajectoryLength: 0,
        dwellTimeMs: Math.round(currentDwell * 10) / 10,
        scrollDepthPercentage: this.maxScrollDepth,
        scrollVelocity: Math.round(this.lastScrollVelocity * 1000) / 1000,
        trajectoryEntropy: 0,
        timestamp: performance.now()
      };
    }

    let totalDist = 0;
    let maxVel = 0;
    const velocities: number[] = [];
    const accelerations: number[] = [];
    let hesitationCounter = 0;
    const directionBins = new Array(8).fill(0);
    let totalAngles = 0;

    for (let i = 1; i < count; i++) {
      const dt = Math.max(1, points[i].timestamp - points[i - 1].timestamp);
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      totalDist += dist;
      const vel = dist / dt;
      velocities.push(vel);
      if (vel > maxVel) maxVel = vel;

      // Angle for Shannon directional entropy
      if (dist > 0) {
        let angle = Math.atan2(dy, dx);
        if (angle < 0) angle += 2 * Math.PI;
        const bin = Math.min(7, Math.floor((angle / (2 * Math.PI)) * 8));
        directionBins[bin]++;
        totalAngles++;
      }

      if (i > 1) {
        const prevVel = velocities[i - 2];
        const prevDt = Math.max(1, points[i - 1].timestamp - points[i - 2].timestamp);
        const accel = (vel - prevVel) / prevDt;
        accelerations.push(accel);

        // Angular hesitation (> 45 degrees directional change)
        const ux = points[i - 1].x - points[i - 2].x;
        const uy = points[i - 1].y - points[i - 2].y;
        const vx = dx;
        const vy = dy;
        const dot = ux * vx + uy * vy;
        const magU = Math.sqrt(ux * ux + uy * uy);
        const magV = Math.sqrt(vx * vx + vy * vy);

        if (magU > 0 && magV > 0) {
          const cosTheta = Math.max(-1, Math.min(1, dot / (magU * magV)));
          const theta = Math.acos(cosTheta);
          if (theta > (Math.PI / 4)) {
            hesitationCounter++;
          }
        }
      }
    }

    const meanVel = velocities.length > 0
      ? velocities.reduce((a, b) => a + b, 0) / velocities.length
      : 0;

    const meanAcc = accelerations.length > 0
      ? accelerations.reduce((a, b) => a + b, 0) / accelerations.length
      : 0;

    // Shannon Trajectory Entropy normalized to [0, 1]
    let trajectoryEntropy = 0;
    if (totalAngles > 0) {
      const maxEntropy = Math.log2(8); // 3
      let entropy = 0;
      for (const count of directionBins) {
        if (count > 0) {
          const p = count / totalAngles;
          entropy -= p * Math.log2(p);
        }
      }
      trajectoryEntropy = Math.min(1, Math.max(0, entropy / maxEntropy));
    }

    return {
      meanVelocity: Math.round(meanVel * 1000) / 1000,
      maxVelocity: Math.round(maxVel * 1000) / 1000,
      meanAcceleration: Math.round(meanAcc * 10000) / 10000,
      hesitationCount: hesitationCounter,
      totalTrajectoryLength: Math.round(totalDist * 100) / 100,
      dwellTimeMs: Math.round(currentDwell * 10) / 10,
      scrollDepthPercentage: this.maxScrollDepth,
      scrollVelocity: Math.round(this.lastScrollVelocity * 1000) / 1000,
      trajectoryEntropy: Math.round(trajectoryEntropy * 1000) / 1000,
      timestamp: performance.now()
    };
  }

  /**
   * Returns the current raw interaction batch without clearing it.
   */
  public getRawBatch(): {
    sessionId: string;
    windowDurationMs: number;
    points: RawPointerPoint[];
    macroEvents: MacroEvent[];
    dwellTimeMs: number;
    scrollDepthPercentage: number;
    scrollVelocity: number;
    timestamp: number;
  } {
    let currentDwell = this.totalDwellAccumulator;
    if (this.activeHoverStart !== null) {
      currentDwell += performance.now() - this.activeHoverStart;
    }

    return {
      sessionId: this.sessionId,
      windowDurationMs: this.bufferWindowMs,
      points: [...this.pointBuffer],
      macroEvents: [...this.macroQueue],
      dwellTimeMs: currentDwell,
      scrollDepthPercentage: this.maxScrollDepth,
      scrollVelocity: this.lastScrollVelocity,
      timestamp: performance.now()
    };
  }

  /**
   * Dispatches buffered features and purges raw coordinate data immediately
   * (Ephemeral Purge for memory safety and zero telemetry leakage).
   */
  public flush(): void {
    const tensorFeatures = this.extractMicroFeatures();

    const packet: InteractionPacket = {
      sessionId: this.sessionId,
      windowDurationMs: this.bufferWindowMs,
      macroEvents: [...this.macroQueue],
      features: tensorFeatures
    };

    // Dispatch to listener (WASM worker / pipeline)
    this.onFlushCallback(packet);

    // Ephemeral Purge: Clean raw points immediately to preserve memory (<20MB constraint) and privacy
    this.pointBuffer = [];
    this.macroQueue = [];
    this.totalDwellAccumulator = 0;
    if (this.activeHoverStart !== null) {
      this.activeHoverStart = performance.now();
    }
  }

  private startBufferingCycle(): void {
    this.flushTimer = window.setInterval(() => {
      this.flush();
    }, this.bufferWindowMs);
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (typeof window !== 'undefined') {
      if (this.boundPointerMove) window.removeEventListener('pointermove', this.boundPointerMove);
      if (this.boundPointerOver) document.body.removeEventListener('pointerover', this.boundPointerOver);
      if (this.boundPointerOut) document.body.removeEventListener('pointerout', this.boundPointerOut);
      if (this.boundClick) window.removeEventListener('click', this.boundClick);
      if (this.boundScroll) window.removeEventListener('scroll', this.boundScroll);
    }
  }

  public destroy(): void {
    this.stop();
    this.pointBuffer = [];
    this.macroQueue = [];
  }
}
