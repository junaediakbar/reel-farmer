import { useEffect, useState } from "react";

interface DepStatus {
  id: string;
  label: string;
  installed: boolean;
  sizeEstimateMb: number;
  manual?: { reason: string; instructionsUrl: string };
}

interface InstallProgress {
  id: string;
  phase: "downloading" | "verifying" | "extracting" | "installing" | "done" | "failed" | "manual";
  bytesDownloaded?: number;
  bytesTotal?: number;
  message?: string;
}

function badgeStatus(dep: DepStatus, phase: InstallProgress["phase"] | undefined): string {
  if (dep.installed || phase === "done") return "completed";
  if (phase === "failed") return "failed";
  if (phase) return "running";
  return "";
}

/** First-run dependency wizard — shown only when yt-dlp/ffmpeg/whisper-cli/model aren't already reachable
 * (dev machines with these on PATH skip straight past it, see App.tsx). */
export function Setup({ onReady }: { onReady: () => void }) {
  const [statuses, setStatuses] = useState<DepStatus[] | null>(null);
  const [progress, setProgress] = useState<Record<string, InstallProgress>>({});
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshStatus(): Promise<DepStatus[]> {
    const res = await fetch("/api/deps/status");
    const data = (await res.json()) as DepStatus[];
    setStatuses(data);
    if (data.every((d) => d.installed)) onReady();
    return data;
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  async function startInstall() {
    setError(null);
    setInstalling(true);
    try {
      const res = await fetch("/api/deps/install", { method: "POST" });
      if (!res.body) throw new Error("no response body from /api/deps/install");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const payload = event.replace(/^data: /, "").trim();
          if (!payload) continue;
          const p = JSON.parse(payload) as InstallProgress;
          setProgress((prev) => ({ ...prev, [p.id]: p }));
        }
      }
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  }

  if (statuses === null || statuses.every((d) => d.installed)) return null;

  const totalMb = statuses.filter((d) => !d.installed).reduce((sum, d) => sum + d.sizeEstimateMb, 0);
  const anyFailed = statuses.some((d) => progress[d.id]?.phase === "failed");

  return (
    <div className="app-shell">
      <div className="main-area">
        <div className="page">
          <header className="page-header">
            <h1>Setting up Reel Farmer</h1>
            <p className="subtitle">A few tools are needed before the first run — about {totalMb} MB total.</p>
          </header>

          <div className="card setup-wizard">
            {statuses.map((dep) => {
              const p = progress[dep.id];
              const phase = dep.installed ? "done" : p?.phase;
              const pct = p?.bytesTotal ? Math.min(100, Math.round((100 * (p.bytesDownloaded ?? 0)) / p.bytesTotal)) : null;
              return (
                <div key={dep.id} className="dep-row">
                  <div className="dep-row-main">
                    <span>{dep.label}</span>
                    <span className={`status-badge status-${badgeStatus(dep, phase)}`}>
                      {dep.installed ? "ready" : (phase ?? `${dep.sizeEstimateMb} MB`)}
                    </span>
                  </div>
                  {phase === "downloading" && pct !== null && (
                    <div className="dep-progress-track">
                      <div className="dep-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {!dep.installed && dep.manual && (
                    <p className="run-stage">
                      {dep.manual.reason} — see{" "}
                      <a href={dep.manual.instructionsUrl} target="_blank" rel="noreferrer">
                        install instructions
                      </a>
                      .
                    </p>
                  )}
                  {phase === "failed" && p?.message && <p className="error-text">{p.message}</p>}
                </div>
              );
            })}
          </div>

          {error && <p className="error-text">{error}</p>}
          <button type="button" className="btn-primary" onClick={startInstall} disabled={installing}>
            {installing ? "Installing…" : anyFailed ? "Retry failed" : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}
