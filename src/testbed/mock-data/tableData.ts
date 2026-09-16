export interface ReportData {
  id: string;
  date: string;
  region: string;
  category: string;
  sales: number;
  status: 'Completed' | 'Pending' | 'Failed';
}

export const generateMockData = (count: number): ReportData[] => {
  const regions = ['North America', 'Europe', 'Asia Pacific'];
  const categories = ['Electronics', 'Clothing', 'Books'];
  const statuses: ReportData['status'][] = ['Completed', 'Pending', 'Failed'];

  return Array.from({ length: count }).map((_, i) => ({
    id: `REP-${1000 + i}`,
    date: new Date(Date.now() - Math.floor(Math.random() * 10000000000)).toISOString().split('T')[0],
    region: regions[Math.floor(Math.random() * regions.length)],
    category: categories[Math.floor(Math.random() * categories.length)],
    sales: Math.floor(Math.random() * 5000) + 100,
    status: statuses[Math.floor(Math.random() * statuses.length)]
  }));
};

export const defaultTableData = generateMockData(50);
