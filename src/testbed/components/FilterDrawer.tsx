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
    {
      name: 'Date Range',
      content: (
        <input
          type="date"
          data-aui-component="filter-date-input"
          data-aui-role="form-field"
          data-aui-action="change"
          style={{ width: '100%', padding: '4px' }}
        />
      )
    },
    {
      name: 'Region',
      content: (
        <select
          data-aui-component="filter-Region-select"
          data-aui-role="filter"
          data-aui-action="change"
          data-aui-task-role="required"
          style={{ width: '100%', padding: '4px' }}
        >
          <option>North America</option>
          <option>Europe</option>
          <option>Asia Pacific</option>
        </select>
      )
    },
    {
      name: 'Product Category',
      content: (
        <div>
          <label style={{ display: 'block' }}>
            <input
              type="checkbox"
              data-aui-component="filter-category-electronics"
              data-aui-role="filter"
              data-aui-action="change"
            /> Electronics
          </label>
          <label style={{ display: 'block' }}>
            <input
              type="checkbox"
              data-aui-component="filter-category-clothing"
              data-aui-role="filter"
              data-aui-action="change"
            /> Clothing
          </label>
          <label style={{ display: 'block' }}>
            <input
              type="checkbox"
              data-aui-component="filter-category-books"
              data-aui-role="filter"
              data-aui-action="change"
            /> Books
          </label>
        </div>
      )
    },
    {
      name: 'Advanced Options',
      content: (
        <div>
          <label style={{ display: 'block', marginBottom: '8px' }}>
            Customer Segment
            <select
              data-aui-component="filter-segment-select"
              data-aui-role="filter"
              data-aui-action="change"
              data-aui-task-role="required"
              style={{ width: '100%', padding: '4px', marginTop: '4px' }}
            >
              <option>All</option>
              <option>New</option>
              <option>Returning</option>
            </select>
          </label>
        </div>
      )
    }
  ];

  return (
    <div
      data-aui-component="filter-drawer"
      data-aui-role="filter"
      style={{ width: '250px', borderRight: '1px solid #ccc', padding: '16px', background: '#fafafa' }}
    >
      <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Filters</h3>
      {sections.map(section => (
        <div key={section.name} style={{ marginBottom: '8px', border: '1px solid #ddd', borderRadius: '4px', background: '#fff' }}>
          <button
            onClick={() => toggleSection(section.name)}
            data-aui-component={`filter-${section.name}`}
            data-aui-role="accordion"
            data-aui-action="click"
            aria-expanded={openSections[section.name]}
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
      <button
        data-aui-component="btn-apply-filters"
        data-aui-role="primary-action"
        data-aui-action="click"
        data-aui-task-role="required"
        style={{ width: '100%', padding: '8px', background: '#006064', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', marginTop: '16px' }}
      >
        Apply Filters
      </button>
    </div>
  );
}
