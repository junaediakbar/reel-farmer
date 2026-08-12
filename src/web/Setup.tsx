import { useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import { Badge, type BadgeProps } from "./components/ui/badge";

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

function badgeVariant(dep: DepStatus, phase: InstallProgress["phase"] | undefined): BadgeProps["variant"] {
  if (dep.installed || phase === "done") return "success";
  if (phase === "failed") return "error";
  if (phase) return "running";
  return "neutral";
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
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <span className="pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <div className="soft-shadow relative flex w-full max-w-lg flex-col gap-6 rounded-2xl bg-surface-container-lowest p-8">
        <div className="flex flex-col gap-1 text-center">
          <span className="inner-glow mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary-container">
            <span className="material-symbols-outlined text-on-primary-container">download</span>
          </span>
          <h1 className="mt-3 text-headline-lg text-on-surface">Setting up Reel Farmer</h1>
          <p className="text-on-surface-variant">A few tools are needed before the first run — about {totalMb} MB total.</p>
        </div>

        <div className="flex flex-col gap-5">
          {statuses.map((dep) => {
            const p = progress[dep.id];
            const phase = dep.installed ? "done" : p?.phase;
            const pct = p?.bytesTotal ? Math.min(100, Math.round((100 * (p.bytesDownloaded ?? 0)) / p.bytesTotal)) : null;
            return (
              <div key={dep.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-4 font-semibold">
                  <span className="text-sm text-on-surface">{dep.label}</span>
                  <Badge variant={badgeVariant(dep, phase)}>{dep.installed ? "ready" : (phase ?? `${dep.sizeEstimateMb} MB`)}</Badge>
                </div>
                {phase === "downloading" && pct !== null && (
                  <div className="h-2 overflow-hidden rounded-full bg-surface-container">
                    <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary-bright transition-[width]" style={{ width: `${pct}%` }} />
                  </div>
                )}
                {!dep.installed && dep.manual && (
                  <p className="text-sm text-on-surface-variant">
                    {dep.manual.reason} —{" "}
                    <a href={dep.manual.instructionsUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      install instructions
                    </a>
                    .
                  </p>
                )}
                {phase === "failed" && p?.message && <p className="text-sm text-error">{p.message}</p>}
              </div>
            );
          })}
        </div>

        {error && <p className="text-sm text-error">{error}</p>}
        <Button variant="primary" onClick={startInstall} disabled={installing}>
          {installing ? "Installing…" : anyFailed ? "Retry failed" : "Install"}
        </Button>
      </div>
    </div>
  );
}
