const NAV_ITEMS = ["Runs", "Library", "Templates", "Billing", "Settings"];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <h1>Reel Farmer</h1>
        <p>AI Video Studio</p>
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <span key={item} className={item === "Runs" ? "sidebar-link sidebar-link-active" : "sidebar-link sidebar-link-disabled"}>
            {item}
          </span>
        ))}
      </nav>
      <span className="sidebar-link sidebar-link-disabled">Help Center</span>
    </aside>
  );
}
