import { defaultTableData } from '../mock-data/tableData';

export function ResultsTable() {
  return (
    <div style={{ background: '#fff', border: '1px solid #ccc', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px', borderBottom: '1px solid #ccc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Results ({defaultTableData.length})</h3>
        <div>
          <button style={{ padding: '8px 16px', background: '#e0e0e0', border: 'none', borderRadius: '4px', cursor: 'pointer', marginRight: '8px' }}>
            Export Report
          </button>
        </div>
      </div>
      <div style={{ overflowY: 'auto', maxHeight: '400px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ background: '#f5f5f5', position: 'sticky', top: 0, borderBottom: '1px solid #ddd' }}>
            <tr>
              <th style={{ padding: '12px 16px' }}>ID</th>
              <th style={{ padding: '12px 16px' }}>Date</th>
              <th style={{ padding: '12px 16px' }}>
                Region <span title="Geographical sales region">[?]</span>
              </th>
              <th style={{ padding: '12px 16px' }}>Category</th>
              <th style={{ padding: '12px 16px' }}>Sales</th>
              <th style={{ padding: '12px 16px' }}>
                Status <span title="Current processing status">[?]</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {defaultTableData.map((row) => (
              <tr key={row.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '12px 16px' }}>{row.id}</td>
                <td style={{ padding: '12px 16px' }}>{row.date}</td>
                <td style={{ padding: '12px 16px' }}>{row.region}</td>
                <td style={{ padding: '12px 16px' }}>{row.category}</td>
                <td style={{ padding: '12px 16px' }}>${row.sales.toLocaleString()}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    padding: '4px 8px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    background: row.status === 'Completed' ? '#e8f5e9' : row.status === 'Pending' ? '#fff3e0' : '#ffebee',
                    color: row.status === 'Completed' ? '#2e7d32' : row.status === 'Pending' ? '#ef6c00' : '#c62828'
                  }}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
