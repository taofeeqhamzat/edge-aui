export function KPICards() {
  const kpis = [
    { label: 'Total Revenue', value: '$124,500', change: '+12%' },
    { label: 'Active Users', value: '4,521', change: '+5%' },
    { label: 'Conversion Rate', value: '3.2%', change: '-1.1%' },
    { label: 'Avg Order Value', value: '$68.50', change: '+2.4%' }
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
      {kpis.map((kpi, index) => (
        <div key={index} style={{ border: '1px solid #ccc', padding: '16px', borderRadius: '8px', background: '#fff' }}>
          <div style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>{kpi.label}</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>{kpi.value}</div>
          <div style={{ fontSize: '14px', color: kpi.change.startsWith('+') ? 'green' : 'red' }}>
            {kpi.change} vs last month
          </div>
        </div>
      ))}
    </div>
  );
}
