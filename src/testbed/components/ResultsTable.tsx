import { defaultTableData } from '../mock-data/tableData';

export function ResultsTable() {
  return (
    <div
      data-aui-component="results-table"
      data-aui-role="table"
      style={{ background: '#fff', border: '1px solid #ccc', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ padding: '16px', borderBottom: '1px solid #ccc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Results ({defaultTableData.length})</h3>
        <div>
          <button
            data-aui-component="btn-export"
            data-aui-role="primary-action"
            data-aui-action="click"
            data-aui-task-role="required"
            style={{ padding: '8px 16px', background: '#e0e0e0', border: 'none', borderRadius: '4px', cursor: 'pointer', marginRight: '8px' }}
          >
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
                Region{' '}
                <span
                  data-aui-component="tooltip-region"
                  data-aui-role="tooltip"
                  data-aui-action="hover"
                  title="Geographical sales region"
                  style={{ cursor: 'help' }}
                >
                  [?]
                </span>
              </th>
              <th style={{ padding: '12px 16px' }}>Category</th>
              <th style={{ padding: '12px 16px' }}>Sales</th>
              <th style={{ padding: '12px 16px' }}>
                Status{' '}
                <span
                  data-aui-component="tooltip-status"
                  data-aui-role="tooltip"
                  data-aui-action="hover"
                  title="Current processing status"
                  style={{ cursor: 'help' }}
                >
                  [?]
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {defaultTableData.map((row) => (
              <tr
                key={row.id}
                data-aui-component={`table-row-${row.id}`}
                data-aui-role="table-row"
                data-aui-action="hover"
                style={{ borderBottom: '1px solid #eee' }}
              >
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
