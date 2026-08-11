import { useEffect, useState } from "react";
import type { PipelineRun } from "../pipeline/types";
import { RunDetail } from "./RunDetail";
import { Setup } from "./Setup";
import { Sidebar } from "./Sidebar";

interface ExistingVideo {
  videoId: string;
  title: string;
}

export function App() {
  const [depsReady, setDepsReady] = useState(false);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [existingVideos, setExistingVideos] = useState<ExistingVideo[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
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
      setSelectedRunId(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function deleteRun(id: string) {
    await fetch(`/api/runs/${id}`, { method: "DELETE" });
    if (selectedRunId === id) setSelectedRunId(null);
    refresh();
  }

  if (!depsReady) return <Setup onReady={() => setDepsReady(true)} />;

  if (selectedRunId) {
    return (
      <div className="app-shell">
        <Sidebar />
        <div className="main-area">
          <RunDetail
            runId={selectedRunId}
            onBack={() => setSelectedRunId(null)}
            onDeleted={() => {
              setSelectedRunId(null);
              refresh();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-area">
        <div className="page">
      <header className="page-header">
        <h1>Reel Farmer</h1>
        <p className="subtitle">Turn a long video into ready-to-post vertical clips.</p>
      </header>

      <form className="card create-run-form" onSubmit={createRun}>
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
          {creating ? "Starting…" : "Start run"}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>

      <section className="run-list">
        {runs.length === 0 && <p className="empty">No runs yet.</p>}
        {runs.map((run) => (
          <article key={run.id} className="card run-card" onClick={() => setSelectedRunId(run.id)}>
            <div className="run-card-main">
              <h3>{run.title ?? run.videoUrl}</h3>
              <span className={`status-badge status-${run.status}`}>{run.status.replace("_", " ")}</span>
            </div>
            {run.currentStage && <p className="run-stage">{run.currentStage}</p>}
            {run.errorMessage && <p className="error-text">{run.errorMessage}</p>}
            <button
              type="button"
              className="btn-ghost"
              onClick={(e) => {
                e.stopPropagation();
                deleteRun(run.id);
              }}
            >
              Delete
            </button>
          </article>
        ))}
      </section>
        </div>
      </div>
    </div>
  );
}
