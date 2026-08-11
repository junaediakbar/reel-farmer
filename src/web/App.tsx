import { useEffect, useState } from "react";
import { CLIP_STAGES, GLOBAL_STAGES, type PipelineRun } from "../pipeline/types";
import { RunDetail } from "./RunDetail";
import { LicenseGate } from "./LicenseGate";
import { Setup } from "./Setup";
import { Sidebar, type Page } from "./Sidebar";
import { Library } from "./Library";
import { Settings } from "./Settings";

interface ExistingVideo {
  videoId: string;
  title: string;
}

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The source video is downloaded (and safe to preview) once a run moves past the DOWNLOAD stage. */
function hasSourceVideo(run: PipelineRun): boolean {
  return run.status !== "pending" && run.currentStage !== "DOWNLOAD";
}

const STAGE_ORDER = [...GLOBAL_STAGES, ...CLIP_STAGES];

/** Rough completion percentage for a running run, from its position in the fixed stage order — no per-clip granularity. */
function runProgressPct(run: PipelineRun): number {
  if (!run.currentStage) return 0;
  const idx = STAGE_ORDER.indexOf(run.currentStage);
  return idx === -1 ? 0 : Math.round(((idx + 1) / STAGE_ORDER.length) * 100);
}

type Route =
  | { name: "runs" }
  | { name: "create" }
  | { name: "run"; id: string }
  | { name: "library" }
  | { name: "settings" };

/** URL scheme: /runs (list), /runs/new (create), /runs/:id (detail), /library, /settings — anything else falls back to the runs list. */
function parseRoute(pathname: string): Route {
  if (pathname === "/library") return { name: "library" };
  if (pathname === "/settings") return { name: "settings" };
  if (pathname === "/runs/new") return { name: "create" };
  const runMatch = pathname.match(/^\/runs\/([^/]+)$/);
  if (runMatch) return { name: "run", id: runMatch[1] };
  return { name: "runs" };
}

function sidebarPage(route: Route): Page {
  return route.name === "library" || route.name === "settings" ? route.name : "runs";
}

export function App() {
  const [licenseValid, setLicenseValid] = useState(false);
  const [depsReady, setDepsReady] = useState(false);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [existingVideos, setExistingVideos] = useState<ExistingVideo[]>([]);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [existingVideoId, setExistingVideoId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/runs");
    setRuns(await res.json());
  }

  useEffect(() => {
    refresh();
    fetch("/api/videos")
      .then((r) => r.json())
      .then(setExistingVideos);
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function onPopState() {
      setRoute(parseRoute(window.location.pathname));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function go(path: string) {
    window.history.pushState(null, "", path);
    setRoute(parseRoute(path));
  }

  async function createRun(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const body = existingVideoId ? { existingVideoId } : { youtubeUrl };
      const res = await fetch("/api/runs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed to create run");
      const { runId } = (await res.json()) as { runId: string };
      setYoutubeUrl("");
      setExistingVideoId("");
      await refresh();
      go(`/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function deleteRun(id: string) {
    await fetch(`/api/runs/${id}`, { method: "DELETE" });
    if (route.name === "run" && route.id === id) go("/runs");
    refresh();
  }

  async function retryRun(id: string) {
    await fetch(`/api/runs/${id}/retry`, { method: "POST" });
    refresh();
  }

  if (!licenseValid) return <LicenseGate onReady={() => setLicenseValid(true)} />;
  if (!depsReady) return <Setup onReady={() => setDepsReady(true)} />;

  if (route.name === "run") {
    return (
      <div className="app-shell">
        <Sidebar page={sidebarPage(route)} onNavigate={go} onCreateRun={() => go("/runs/new")} />
        <div className="main-area">
          <RunDetail
            runId={route.id}
            onBack={() => go("/runs")}
            onDeleted={() => {
              go("/runs");
              refresh();
            }}
          />
        </div>
      </div>
    );
  }

  const completedRuns = runs.filter((r) => r.status === "completed").length;
  const runningRuns = runs.filter((r) => r.status === "running").length;
  const failedRuns = runs.filter((r) => r.status === "failed").length;
  const awaitingRuns = runs.filter((r) => r.status === "awaiting_selection").length;
  const successRate = runs.length > 0 ? Math.round((completedRuns / runs.length) * 100) : 0;

  return (
    <div className="app-shell">
      <Sidebar page={sidebarPage(route)} onNavigate={go} onCreateRun={() => go("/runs/new")} />
      <div className="main-area">
        {route.name === "library" && <Library />}
        {route.name === "settings" && <Settings />}
        {(route.name === "runs" || route.name === "create") && (
          <>
            <header className="topbar">
              <h2>{route.name === "create" ? "Create New Run" : "Runs"}</h2>
              <div className="run-detail-actions">
                <span className="icon-btn">
                  <span className="material-symbols-outlined">notifications</span>
                </span>
                <span className="icon-btn">
                  <span className="material-symbols-outlined">mail</span>
                </span>
              </div>
            </header>
            <div className="page">
              <span className="blur-orb" style={{ width: 260, height: 260, top: -80, right: -60, background: "rgba(70,72,212,0.12)" }} />
              <span className="blur-orb" style={{ width: 200, height: 200, bottom: -60, left: -40, background: "rgba(129,39,207,0.10)" }} />
              {route.name === "create" ? (
                <section className="card hero-create">
                  <button type="button" className="icon-btn" onClick={() => go("/runs")} aria-label="Back to runs">
                    <span className="material-symbols-outlined">arrow_back</span>
                  </button>
                  <h1>
                    Find your next <span className="accent">viral moment.</span>
                  </h1>
                  <p className="subtitle">
                    Paste a YouTube link — Reel Farmer downloads it, transcribes it, and finds the clips worth cutting.
                  </p>
                  <form onSubmit={createRun}>
                    <label>
                      YouTube URL
                      <input
                        type="url"
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={youtubeUrl}
                        onChange={(e) => {
                          setYoutubeUrl(e.target.value);
                          setExistingVideoId("");
                        }}
                        disabled={creating || Boolean(existingVideoId)}
                      />
                    </label>
                    {existingVideos.length > 0 && (
                      <label>
                        Or reuse a downloaded video
                        <select
                          value={existingVideoId}
                          onChange={(e) => {
                            setExistingVideoId(e.target.value);
                            setYoutubeUrl("");
                          }}
                          disabled={creating}
                        >
                          <option value="">—</option>
                          {existingVideos.map((v) => (
                            <option key={v.videoId} value={v.videoId}>
                              {v.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button type="submit" className="btn-primary" disabled={creating || (!youtubeUrl && !existingVideoId)}>
                      <span className="material-symbols-outlined">add</span>
                      {creating ? "Starting…" : "Start run"}
                    </button>
                    {error && <p className="error-text">{error}</p>}
                  </form>
                  <div className="create-steps">
                    <div className="create-step">
                      <span className="create-step-num">1</span>
                      <div>
                        <h4>Paste URL</h4>
                        <p>Any public YouTube video.</p>
                      </div>
                    </div>
                    <div className="create-step">
                      <span className="create-step-num">2</span>
                      <div>
                        <h4>AI finds highlights</h4>
                        <p>Transcribes the video and scores the most shareable moments.</p>
                      </div>
                    </div>
                    <div className="create-step">
                      <span className="create-step-num">3</span>
                      <div>
                        <h4>Pick &amp; render</h4>
                        <p>Trim, add captions, export vertical clips.</p>
                      </div>
                    </div>
                  </div>
                </section>
              ) : (
                <>
                  <p className="subtitle">Turn a long video into ready-to-post vertical clips.</p>

                  <section className="stat-grid">
                    <div className="glass-panel stat-card">
                      <div className="stat-card-top">
                        <span>Total Runs</span>
                        <span className="material-symbols-outlined" style={{ color: "var(--primary)" }}>
                          play_circle
                        </span>
                      </div>
                      <div className="stat-card-value">{runs.length}</div>
                      <div className={`stat-card-trend${failedRuns > 0 ? " stat-card-trend-alert" : ""}`}>
                        {failedRuns > 0 ? `${failedRuns} failed` : "All clear"}
                      </div>
                    </div>
                    <div className="glass-panel stat-card">
                      <div className="stat-card-top">
                        <span>Completed</span>
                        <span className="material-symbols-outlined" style={{ color: "var(--secondary)" }}>
                          check_circle
                        </span>
                      </div>
                      <div className="stat-card-value">{completedRuns}</div>
                      <div className="stat-card-trend">{successRate}% success rate</div>
                    </div>
                    <div className="glass-panel stat-card">
                      <div className="stat-card-top">
                        <span>Running</span>
                        <span className="material-symbols-outlined" style={{ color: "var(--tertiary)" }}>
                          sync
                        </span>
                      </div>
                      <div className="stat-card-value">{runningRuns}</div>
                      <div className="stat-card-trend">{awaitingRuns} awaiting selection</div>
                    </div>
                  </section>

                  <section className="run-grid">
                    <button type="button" className="card run-card-add" onClick={() => go("/runs/new")}>
                      <span className="material-symbols-outlined">add_circle</span>
                      Start New Run
                    </button>
                    {runs.map((run) => (
                      <article key={run.id} className="card run-card" onClick={() => go(`/runs/${run.id}`)}>
                        <div className="run-card-media">
                          {hasSourceVideo(run) ? (
                            <video src={`/api/runs/${run.id}/video`} muted preload="metadata" />
                          ) : (
                            <div className="run-card-placeholder">
                              <span className="material-symbols-outlined">hourglass_empty</span>
                            </div>
                          )}
                          {hasSourceVideo(run) && run.status !== "running" && (
                            <div className="run-card-play-overlay">
                              <span className="material-symbols-outlined icon-fill">play_arrow</span>
                            </div>
                          )}
                          {run.status === "running" && (
                            <div className="run-card-progress">
                              <div className="run-card-progress-fill" style={{ width: `${runProgressPct(run)}%` }} />
                            </div>
                          )}
                          <span className={`status-badge status-${run.status} run-card-status`}>{run.status.replace("_", " ")}</span>
                        </div>
                        <div className="run-card-body">
                          <h3>{run.title ?? run.videoUrl}</h3>
                          <p className="run-stage">
                            {timeAgo(run.createdAt)}
                            {run.status === "running" && run.currentStage ? ` · ${run.currentStage}` : ""}
                          </p>
                          {run.errorMessage && <p className="error-text">{run.errorMessage}</p>}
                          <div className="run-card-actions">
                            {run.status === "failed" && (
                              <button
                                type="button"
                                className="btn-ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  retryRun(run.id);
                                }}
                              >
                                <span className="material-symbols-outlined">refresh</span>
                                Retry
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn-ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteRun(run.id);
                              }}
                            >
                              <span className="material-symbols-outlined">delete</span>
                              Delete
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </section>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
