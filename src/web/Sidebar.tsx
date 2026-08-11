export type Page = "runs" | "library" | "settings";

const NAV_ITEMS: Array<{ id: Page; label: string; icon: string; path: string }> = [
  { id: "runs", label: "Runs", icon: "play_circle", path: "/runs" },
  { id: "library", label: "Library", icon: "video_library", path: "/library" },
  { id: "settings", label: "Settings", icon: "settings", path: "/settings" },
];

// No backing functionality yet (no template system, no subscription billing model — Reel Farmer is BYOK per PRD §0.1).
const DISABLED_ITEMS = [
  { label: "Templates", icon: "auto_awesome_motion" },
  { label: "Billing", icon: "payments" },
];

export function Sidebar({
  page,
  onNavigate,
  onCreateRun,
}: {
  page: Page;
  onNavigate: (path: string) => void;
  onCreateRun: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="material-symbols-outlined icon-fill">auto_awesome</span>
        <div>
          <h1>Reel Farmer</h1>
          <p>AI Video Studio</p>
        </div>
      </div>
      <button type="button" className="btn-primary sidebar-create-btn" onClick={onCreateRun}>
        <span className="material-symbols-outlined">add</span>
        Create New Run
      </button>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === page ? "sidebar-link sidebar-link-active" : "sidebar-link"}
            onClick={() => onNavigate(item.path)}
          >
            <span className={`material-symbols-outlined${item.id === page ? " icon-fill" : ""}`}>{item.icon}</span>
            {item.label}
          </button>
        ))}
        {DISABLED_ITEMS.map((item) => (
          <span key={item.label} className="sidebar-link sidebar-link-disabled">
            <span className="material-symbols-outlined">{item.icon}</span>
            {item.label}
          </span>
        ))}
      </nav>
      <span className="sidebar-link sidebar-link-disabled">
        <span className="material-symbols-outlined">help</span>
        Help Center
      </span>
    </aside>
  );
}
