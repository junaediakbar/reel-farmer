import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Input } from "./components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";

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
  const navigate = useNavigate();
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
    <div className="flex flex-col">
      <header className="sticky top-0 z-10 flex h-20 flex-wrap items-center justify-between gap-3 bg-surface/70 px-6 backdrop-blur-xl">
        <h2 className="text-headline-lg text-primary">Library</h2>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
            <Input className="pl-10" placeholder="Search clips…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Recent</SelectItem>
              <SelectItem value="score">Highest viral score</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-stack-md px-6 pb-24">
        <p className="text-body-lg text-on-surface-variant">Every rendered clip across your runs.</p>

        {clips === null && <p className="text-on-surface-variant">Loading…</p>}
        {clips?.length === 0 && <p className="text-on-surface-variant">No rendered clips yet — render one from a run.</p>}
        {clips && clips.length > 0 && visibleClips.length === 0 && <p className="text-on-surface-variant">No clips match "{query}".</p>}

        <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleClips.map((clip) => (
            <article
              key={`${clip.runId}:${clip.clipId}`}
              className="flex flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="relative aspect-[9/16] bg-surface-variant">
                <video src={`/api/runs/${clip.runId}/clips/${clip.clipId}/video`} controls preload="metadata" className="h-full w-full object-cover" />
                <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-1 text-xs font-semibold text-white backdrop-blur-md">
                  {clip.durationSec}s
                </span>
                <Badge variant="secondary" className="pointer-events-none absolute right-2 top-2 shadow-sm">
                  <span className="material-symbols-outlined icon-fill">local_fire_department</span>
                  {clip.viralScore}
                </Badge>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <h3 className="line-clamp-2 text-label-md leading-tight text-on-surface">{clip.title}</h3>
                {clip.runTitle && <p className="text-xs text-on-surface-variant">{clip.runTitle}</p>}
                <p className="text-xs text-on-surface-variant">{timeAgo(clip.renderedAt)}</p>
                <div className="flex flex-wrap gap-2">
                  {clip.tags.map((tag) => (
                    <Badge key={tag} variant="tag">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => navigate(`/runs/${clip.runId}/clips/${clip.clipId}/captions`)}>
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                    Edit captions
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteClip(clip)}>
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                    Delete
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
