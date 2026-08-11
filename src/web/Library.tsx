import { useEffect, useMemo, useState } from "react";

interface RenderedClip {
  runId: string;
  clipId: string;
  runTitle: string | null;
  title: string;
  viralScore: number;
  tags: string[];
  durationSec: number;
  renderedAt: string;
}

type SortMode = "recent" | "score" | "oldest";

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function Library() {
  const [clips, setClips] = useState<RenderedClip[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");

  function refresh() {
    fetch("/api/clips")
      .then((r) => r.json())
      .then(setClips);
  }

  useEffect(refresh, []);

  async function deleteClip(clip: RenderedClip) {
    await fetch(`/api/runs/${clip.runId}/clips/${clip.clipId}`, { method: "DELETE" });
    setClips((prev) => prev?.filter((c) => c.clipId !== clip.clipId) ?? null);
  }

  const visibleClips = useMemo(() => {
    const filtered = (clips ?? []).filter((c) => c.title.toLowerCase().includes(query.toLowerCase()));
    return [...filtered].sort((a, b) => {
      if (sort === "score") return b.viralScore - a.viralScore;
      const delta = new Date(b.renderedAt).getTime() - new Date(a.renderedAt).getTime();
      return sort === "oldest" ? -delta : delta;
    });
  }, [clips, query, sort]);

  return (
    <>
      <header className="topbar">
        <h2>Library</h2>
        <div className="toolbar">
          <div className="search-input">
            <span className="material-symbols-outlined">search</span>
            <input type="text" placeholder="Search clips…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
            <option value="recent">Recent</option>
            <option value="score">Highest viral score</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
      </header>

      <div className="page">
        <p className="subtitle">Every rendered clip across your runs.</p>

        {clips === null && <p className="empty">Loading…</p>}
        {clips?.length === 0 && <p className="empty">No rendered clips yet — render one from a run.</p>}
        {clips && clips.length > 0 && visibleClips.length === 0 && <p className="empty">No clips match "{query}".</p>}

        <div className="clip-grid">
          {visibleClips.map((clip) => (
            <article key={`${clip.runId}:${clip.clipId}`} className="card clip-card">
              <div className="clip-card-media">
                <video src={`/api/runs/${clip.runId}/clips/${clip.clipId}/video`} controls preload="metadata" />
                <span className="clip-thumb-badge clip-thumb-duration">{clip.durationSec}s</span>
                <span className="clip-thumb-badge clip-thumb-score">
                  <span className="material-symbols-outlined icon-fill">local_fire_department</span>
                  {clip.viralScore}
                </span>
              </div>
              <div className="clip-card-body">
                <h3>{clip.title}</h3>
                {clip.runTitle && <p className="run-stage">{clip.runTitle}</p>}
                <p className="clip-card-time">{timeAgo(clip.renderedAt)}</p>
                <div className="clip-card-meta">
                  {clip.tags.map((tag) => (
                    <span key={tag} className="tag-chip">
                      {tag}
                    </span>
                  ))}
                </div>
                <button type="button" className="btn-ghost" onClick={() => deleteClip(clip)}>
                  <span className="material-symbols-outlined">delete</span>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
