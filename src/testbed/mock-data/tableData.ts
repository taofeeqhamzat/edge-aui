export interface ReportData {
  id: string;
  date: string;
  region: string;
  category: string;
  sales: number;
  status: 'Completed' | 'Pending' | 'Failed';
}

export const REPORT_REGIONS = ['North America', 'Europe', 'Asia Pacific'] as const;
export const REPORT_CATEGORIES = ['Electronics', 'Clothing', 'Books'] as const;
export const REPORT_STATUSES: ReportData['status'][] = ['Completed', 'Pending', 'Failed'];

/**
 * Deterministic seeded PRNG (mulberry32).
 *
 * The previous implementation called `Math.random()` at module load, so two sessions
 * saw different stimuli — which makes adaptive/baseline comparison and cross-participant
 * pooling impossible (assessment §6.1). The dataset is now a pure function of its seed.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a deterministic report dataset. The same seed always yields identical rows,
 * so every participant and every condition sees the same stimuli.
 */
export function generateDeterministicData(count: number, seed = 20250921): ReportData[] {
  const random = mulberry32(seed);
  const baseDate = Date.UTC(2025, 0, 1);
  const dayMs = 24 * 60 * 60 * 1000;

  return Array.from({ length: count }).map((_, i) => {
    const dayOffset = Math.floor(random() * 240);
    return {
      id: `REP-${1000 + i}`,
      date: new Date(baseDate + dayOffset * dayMs).toISOString().split('T')[0],
      region: REPORT_REGIONS[Math.floor(random() * REPORT_REGIONS.length)],
      category: REPORT_CATEGORIES[Math.floor(random() * REPORT_CATEGORIES.length)],
      sales: Math.floor(random() * 5000) + 100,
      status: REPORT_STATUSES[Math.floor(random() * REPORT_STATUSES.length)]
    };
  });
}

/** Deterministic 50-row stimulus set used by the testbed. */
export const defaultTableData: ReportData[] = generateDeterministicData(50);

/** Backwards-compatible alias retained for existing imports. */
export const generateMockData = (count: number, seed?: number): ReportData[] =>
  generateDeterministicData(count, seed);
