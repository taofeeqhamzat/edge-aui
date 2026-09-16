import { useState } from 'react';

export function FilterDrawer() {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    'Date Range': true,
    'Region': true,
    'Product Category': false,
    'Advanced Options': false
  });

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const sections = [
    { name: 'Date Range', content: <input type="date" style={{ width: '100%', padding: '4px' }} /> },
    { name: 'Region', content: (
      <select style={{ width: '100%', padding: '4px' }}>
        <option>North America</option>
        <option>Europe</option>
        <option>Asia Pacific</option>
      </select>
    ) },
    { name: 'Product Category', content: (
      <div>
        <label style={{ display: 'block' }}><input type="checkbox" /> Electronics</label>
        <label style={{ display: 'block' }}><input type="checkbox" /> Clothing</label>
        <label style={{ display: 'block' }}><input type="checkbox" /> Books</label>
      </div>
    ) },
    { name: 'Advanced Options', content: (
      <div>
        <label style={{ display: 'block', marginBottom: '8px' }}>
          Customer Segment
          <select style={{ width: '100%', padding: '4px', marginTop: '4px' }}>
            <option>All</option>
            <option>New</option>
            <option>Returning</option>
          </select>
        </label>
      </div>
    ) }
  ];

  return (
    <div style={{ width: '250px', borderRight: '1px solid #ccc', padding: '16px', background: '#fafafa' }}>
      <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Filters</h3>
      {sections.map(section => (
        <div key={section.name} style={{ marginBottom: '8px', border: '1px solid #ddd', borderRadius: '4px', background: '#fff' }}>
          <button
            onClick={() => toggleSection(section.name)}
            style={{ width: '100%', padding: '8px', textAlign: 'left', background: 'none', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}
          >
            {openSections[section.name] ? '▼' : '▶'} {section.name}
          </button>
          {openSections[section.name] && (
            <div style={{ padding: '8px', borderTop: '1px solid #ddd' }}>
              {section.content}
            </div>
          )}
        </div>
      ))}
      <button style={{ width: '100%', padding: '8px', background: '#006064', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', marginTop: '16px' }}>
        Apply Filters
      </button>
    </div>
  );
}
