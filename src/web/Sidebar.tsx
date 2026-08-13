import { NavLink } from "react-router";
import { Button } from "./components/ui/button";

const NAV_ITEMS = [
  { label: "Runs", icon: "play_circle", path: "/runs" },
  { label: "Library", icon: "video_library", path: "/library" },
  { label: "Settings", icon: "settings", path: "/settings" },
];

// No backing functionality yet (no template system, no subscription billing model — Reel Farmer is BYOK per PRD §0.1).
const DISABLED_ITEMS = [
  { label: "Templates", icon: "auto_awesome_motion" },
  { label: "Billing", icon: "payments" },
];

export function Sidebar({ onCreateRun }: { onCreateRun: () => void }) {
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col gap-stack-md border-r border-outline-variant bg-surface-container-lowest p-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 px-2">
          <div className="inner-glow flex h-10 w-10 items-center justify-center rounded-xl bg-primary-container">
            <span className="material-symbols-outlined text-on-primary-container">movie</span>
          </div>
          <div>
            <h1 className="text-headline-md text-xl font-bold text-primary">Reel Farmer</h1>
            <p className="text-label-sm text-on-surface-variant">AI Video Studio</p>
          </div>
        </div>
        <Button variant="primary" className="mt-4 w-full" onClick={onCreateRun}>
          <span className="material-symbols-outlined text-[20px]">add</span>
          Create New Run
        </Button>
      </div>
      <nav className="mt-4 flex flex-1 flex-col gap-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-4 py-3 text-label-md transition-colors ${
                isActive
                  ? "bg-primary-container font-bold text-on-primary-container"
                  : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              }`
            }
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
        {DISABLED_ITEMS.map((item) => (
          <span
            key={item.label}
            title="Coming soon"
            className="flex cursor-not-allowed items-center gap-3 rounded-xl px-4 py-3 text-label-md text-on-surface-variant opacity-45"
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            {item.label}
          </span>
        ))}
      </nav>
      <div className="mt-auto">
        <span
          title="Coming soon"
          className="flex cursor-not-allowed items-center gap-3 rounded-xl px-4 py-3 text-label-md text-on-surface-variant opacity-45"
        >
          <span className="material-symbols-outlined">help</span>
          Help Center
        </span>
      </div>
    </aside>
  );
}
