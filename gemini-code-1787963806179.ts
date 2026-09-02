/**
 * Data structures for micro-interaction tracking
 */
export interface RawPointerPoint {
  x: number;
  y: number;
  timestamp: number;
}

export interface MicroTensor {
  meanVelocity: number;        // px/ms
  maxVelocity: number;         // px/ms
  meanAcceleration: number;    // px/ms^2
  hesitationCount: number;     // Direction shifts > 45 degrees
  totalTrajectoryLength: number; // Cumulative pixels
  dwellTimeMs: number;         // Milliseconds over active components
  scrollDepthPercentage: number;
  scrollVelocity: number;      // px/ms
  timestamp: number;
}

export interface InteractionPacket {
  sessionId: string;
  windowDurationMs: number;
  macroEvents: Array<{ type: string; targetId: string; timestamp: number }>;
  features: MicroTensor;
}

/**
 * High-performance, client-side Behavioral Observer
 */
export class ClientBehaviorTracker {
  private pointBuffer: RawPointerPoint[] = [];
  private macroQueue: Array<{ type: string; targetId: string; timestamp: number }> = [];
  private isThrottled: boolean = false;
  private lastScrollY: number = window.scrollY;
  private lastScrollTime: number = performance.now();
  private maxScrollDepth: number = 0;
  private activeHoverStart: number | null = null;
  private totalDwellAccumulator: number = 0;
  private flushTimer: number | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly bufferWindowMs: number = 500,
    private readonly onFlushCallback: (packet: InteractionPacket) => void
  ) {
    this.initListeners();
    this.startBufferingCycle();
  }

  private initListeners(): void {
    // 1. Cursor Trajectory Tracking (Throttled via requestAnimationFrame)
    window.addEventListener('pointermove', (event: PointerEvent) => {
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
    }, { passive: true });

    // 2. Temporal & Attention Markers (DOM Hover In/Out)
    document.body.addEventListener('pointerover', (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target && target.getAttribute('data-trackable')) {
        this.activeHoverStart = performance.now();
      }
    }, { passive: true });

    document.body.addEventListener('pointerout', (event: MouseEvent) => {
      if (this.activeHoverStart !== null) {
        this.totalDwellAccumulator += performance.now() - this.activeHoverStart;
        this.activeHoverStart = null;
      }
    }, { passive: true });

    // 3. Macro-Interactions (Discrete clicks)
    window.addEventListener('click', (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      this.macroQueue.push({
        type: 'click',
        targetId: target.id || target.className || 'anonymous_node',
        timestamp: performance.now()
      });
    }, { passive: true });

    // 4. Viewport Kinematics & Scroll Depth
    window.addEventListener('scroll', () => {
      const now = performance.now();
      const currentScrollY = window.scrollY;
      const docHeight = document.documentElement.scrollHeight;
      const vpHeight = window.innerHeight;

      // Calculate relative depth
      const depth = Math.min(100, Math.round(((currentScrollY + vpHeight) / docHeight) * 100));
      if (depth > this.maxScrollDepth) {
        this.maxScrollDepth = depth;
      }

      this.lastScrollY = currentScrollY;
      this.lastScrollTime = now;
    }, { passive: true });
  }

  /**
   * Computes the MicroTensor feature vector from the raw point buffer
   */
  private extractMicroFeatures(): MicroTensor {
    const points = this.pointBuffer;
    const count = points.length;

    if (count < 2) {
      return {
        meanVelocity: 0,
        maxVelocity: 0,
        meanAcceleration: 0,
        hesitationCount: 0,
        totalTrajectoryLength: 0,
        dwellTimeMs: this.totalDwellAccumulator,
        scrollDepthPercentage: this.maxScrollDepth,
        scrollVelocity: 0,
        timestamp: performance.now()
      };
    }

    let totalDist = 0;
    let maxVel = 0;
    let velocities: number[] = [];
    let accelerations: number[] = [];
    let hesitationCounter = 0;

    for (let i = 1; i < count; i++) {
      const dt = Math.max(1, points[i].timestamp - points[i - 1].timestamp);
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      totalDist += dist;
      const vel = dist / dt;
      velocities.push(vel);
      if (vel > maxVel) maxVel = vel;

      if (i > 1) {
        const prevVel = velocities[i - 2];
        const prevDt = Math.max(1, points[i - 1].timestamp - points[i - 2].timestamp);
        const accel = (vel - prevVel) / prevDt;
        accelerations.push(accel);

        // Calculate angular hesitation (> 45 degrees directional change)
        const ux = points[i - 1].x - points[i - 2].x;
        const uy = points[i - 1].y - points[i - 2].y;
        const vx = dx;
        const vy = dy;
        const dot = ux * vx + uy * vy;
        const magU = Math.sqrt(ux * ux + uy * uy);
        const magV = Math.sqrt(vx * vx + vy * vy);

        if (magU > 0 && magV > 0) {
          const cosTheta = Math.max(-1, Math.min(1, dot / (magU * magV)));
          const theta = Math.acos(cosTheta); // Radians
          if (theta > (Math.PI / 4)) { // 45 degrees = π/4 radians
            hesitationCounter++;
          }
        }
      }
    }

    const meanVel = velocities.reduce((a, b) => a + b, 0) / velocities.length;
    const meanAcc = accelerations.length > 0
      ? accelerations.reduce((a, b) => a + b, 0) / accelerations.length
      : 0;

    return {
      meanVelocity: meanVel,
      maxVelocity: maxVel,
      meanAcceleration: meanAcc,
      hesitationCount: hesitationCounter,
      totalTrajectoryLength: totalDist,
      dwellTimeMs: this.totalDwellAccumulator,
      scrollDepthPercentage: this.maxScrollDepth,
      scrollVelocity: 0,
      timestamp: performance.now()
    };
  }

  /**
   * Dispatches buffered features and purges raw coordinate data
   */
  private flush(): void {
    const tensorFeatures = this.extractMicroFeatures();

    const packet: InteractionPacket = {
      sessionId: this.sessionId,
      windowDurationMs: this.bufferWindowMs,
      macroEvents: [...this.macroQueue],
      features: tensorFeatures
    };

    // Dispatch to Web Worker / WASM thread
    this.onFlushCallback(packet);

    // Ephemeral Purge: Clean raw points immediately to preserve memory and privacy
    this.pointBuffer = [];
    this.macroQueue = [];
    this.totalDwellAccumulator = 0;
  }

  private startBufferingCycle(): void {
    this.flushTimer = window.setInterval(() => {
      this.flush();
    }, this.bufferWindowMs);
  }

  public destroy(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
    }
  }
}