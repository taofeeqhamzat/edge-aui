export function KPICards() {
  const kpis = [
    { label: "Total Revenue", value: "$124,500", change: "+12%" },
    { label: "Active Users", value: "4,521", change: "+5%" },
    { label: "Conversion Rate", value: "3.2%", change: "-1.1%" },
    { label: "Avg Order Value", value: "$68.50", change: "+2.4%" },
  ];

  return (
    <div
      data-aui-component="kpi-cards"
      className="kpi-grid"
    >
      {kpis.map((kpi, index) => (
        <div
          key={index}
          className="kpi-card"
          data-aui-component={`kpi-card-${kpi.label.toLowerCase().replace(/\s+/g, "-")}`}
          data-aui-role="kpi-card"
          data-aui-action="hover"
        >
          <div className="kpi-label">{kpi.label}</div>
          <div className="kpi-value">{kpi.value}</div>
          <div className={`kpi-change ${kpi.change.startsWith("+") ? "positive" : "negative"}`}>
            {kpi.change} vs last month
          </div>
        </div>
      ))}
    </div>
  );
}
