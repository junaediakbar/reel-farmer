import { useState } from "react";
import { useNavigate } from "react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { existingVideosAtom, runsAtom } from "./atoms";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";

const STEPS = [
  { num: "01", title: "Paste URL", desc: "Any public YouTube video." },
  { num: "02", title: "AI finds highlights", desc: "Transcribes the video and scores the most shareable moments." },
  { num: "03", title: "Pick & render", desc: "Trim, add captions, export vertical clips." },
];

export function CreateRunPage() {
  const navigate = useNavigate();
  const existingVideos = useAtomValue(existingVideosAtom);
  const setRuns = useSetAtom(runsAtom);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [existingVideoId, setExistingVideoId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createRun(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const body = existingVideoId ? { existingVideoId } : { youtubeUrl };
      const res = await fetch("/api/runs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed to create run");
      const { runId } = (await res.json()) as { runId: string };
      const refreshed = await fetch("/api/runs");
      setRuns(await refreshed.json());
      navigate(`/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative mx-auto flex max-w-[1160px] flex-col gap-stack-md px-6 pb-24 pt-12">
      <span className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
      <section className="glass-panel relative flex flex-col gap-6 overflow-hidden rounded-3xl p-8">
        <button
          type="button"
          onClick={() => navigate("/runs")}
          aria-label="Back to runs"
          className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
        <h1 className="max-w-2xl text-display-lg text-[36px] text-on-surface md:text-[48px]">
          Find your next <span className="text-primary">viral moment.</span>
        </h1>
        <p className="max-w-xl text-body-lg text-on-surface-variant">
          Paste a YouTube link — Reel Farmer downloads it, transcribes it, and finds the clips worth cutting.
        </p>

        <form onSubmit={createRun} className="flex max-w-xl flex-col gap-4">
          <Input
            type="url"
            placeholder="https://www.youtube.com/watch?v=..."
            value={youtubeUrl}
            onChange={(e) => {
              setYoutubeUrl(e.target.value);
              setExistingVideoId("");
            }}
            disabled={creating || Boolean(existingVideoId)}
          />

          {existingVideos.length > 0 && (
            <Select
              value={existingVideoId || undefined}
              onValueChange={(v) => {
                setExistingVideoId(v);
                setYoutubeUrl("");
              }}
              disabled={creating}
            >
              <SelectTrigger>
                <SelectValue placeholder="Or reuse a downloaded video" />
              </SelectTrigger>
              <SelectContent>
                {existingVideos.map((v) => (
                  <SelectItem key={v.videoId} value={v.videoId}>
                    {v.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button type="submit" variant="primary" className="self-start" disabled={creating || (!youtubeUrl && !existingVideoId)}>
            <span className="material-symbols-outlined">auto_awesome</span>
            {creating ? "Starting…" : "Start run"}
          </Button>
          {error && <p className="text-sm text-error">{error}</p>}
        </form>

        <div className="mt-4 flex flex-wrap gap-8 border-t border-surface-container pt-6">
          {STEPS.map((step) => (
            <div key={step.num} className="flex min-w-[200px] flex-1 items-start gap-3">
              <span className="inner-glow flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container text-sm font-bold text-on-primary-container">
                {step.num}
              </span>
              <div>
                <h4 className="text-label-md text-on-surface">{step.title}</h4>
                <p className="text-[13px] text-on-surface-variant">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
