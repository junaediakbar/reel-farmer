import { useState } from "react";
import { useNavigate } from "react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { existingVideosAtom, runsAtom } from "./atoms";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { LANGUAGES } from "./languages";

const STEPS = [
  { num: "01", title: "Paste URL", desc: "Any public YouTube video." },
  { num: "02", title: "AI Analysis", desc: "Extracts clips & hook text." },
  { num: "03", title: "Pick & Render", desc: "Review & export 9:16 clips." },
];

const CONTENT_TYPES = ["General", "Educational", "Comedy", "Gaming", "Business", "News"];

const CLIP_COUNTS = [3, 5, 8, 10];

const DURATIONS = [
  { label: "15-30 sec", min: 15, max: 30 },
  { label: "30-60 sec", min: 30, max: 60 },
  { label: "60-90 sec", min: 60, max: 90 },
  { label: "90-120 sec", min: 90, max: 120 },
];

const PILL_TRIGGER_CLASS =
  "flex h-auto w-auto items-center gap-2 rounded-lg border border-outline-variant/40 bg-surface-container-low px-4 py-2 text-label-sm text-on-surface-variant";

function youtubeThumbnail(url: string): string | null {
  const match = url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return match ? `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg` : null;
}

export function CreateRunPage() {
  const navigate = useNavigate();
  const existingVideos = useAtomValue(existingVideosAtom);
  const setRuns = useSetAtom(runsAtom);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [existingVideoId, setExistingVideoId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentType, setContentType] = useState(CONTENT_TYPES[0]!);
  const [language, setLanguage] = useState("id");
  const [clipCount, setClipCount] = useState(CLIP_COUNTS[1]!);
  const [duration, setDuration] = useState(DURATIONS[2]!);

  async function createRun(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const options = { contentType, language, clipCount, minDurationSec: duration.min, maxDurationSec: duration.max };
      const body = existingVideoId ? { existingVideoId, options } : { youtubeUrl, options };
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

  const thumbnail = youtubeThumbnail(youtubeUrl);

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-10 flex h-20 items-center justify-between bg-surface/70 px-6 backdrop-blur-xl">
        <h2 className="text-headline-lg text-primary">Create New Run</h2>
        <div className="flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant">
            <span className="material-symbols-outlined">notifications</span>
          </span>
          <span className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant">
            <span className="material-symbols-outlined">mail</span>
          </span>
        </div>
      </header>

      <div className="relative mx-auto flex w-full max-w-[1160px] flex-col gap-stack-lg px-6 pb-24 pt-6">
        <span className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />

        <section className="glass-panel relative flex flex-col gap-6 overflow-hidden rounded-3xl p-8">
          <div className="flex items-center gap-2 text-label-md uppercase tracking-wider text-primary">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            New clip
          </div>

          <form onSubmit={createRun} className="flex flex-col gap-8 lg:flex-row">
            <div className="flex flex-1 flex-col gap-6">
              <h1 className="max-w-2xl text-display-lg text-[36px] text-on-surface md:text-[48px]">
                Find your next <span className="text-primary">viral moment.</span>
              </h1>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  type="url"
                  placeholder="Paste YouTube URL here..."
                  value={youtubeUrl}
                  onChange={(e) => {
                    setYoutubeUrl(e.target.value);
                    setExistingVideoId("");
                  }}
                  disabled={creating || Boolean(existingVideoId)}
                  className="h-14 flex-1 rounded-xl"
                />
                <Button
                  type="submit"
                  variant="primary"
                  className="h-14 rounded-xl"
                  disabled={creating || (!youtubeUrl && !existingVideoId)}
                >
                  <span className="material-symbols-outlined">auto_awesome</span>
                  {creating ? "Starting…" : "Find highlights"}
                </Button>
              </div>

              {existingVideos.length > 0 && (
                <Select
                  value={existingVideoId || undefined}
                  onValueChange={(v) => {
                    setExistingVideoId(v);
                    setYoutubeUrl("");
                  }}
                  disabled={creating}
                >
                  <SelectTrigger className="max-w-xs">
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

              {error && <p className="text-sm text-error">{error}</p>}

              <div className="flex flex-wrap gap-3">
                <Select value={contentType} onValueChange={setContentType} disabled={creating}>
                  <SelectTrigger className={PILL_TRIGGER_CLASS}>
                    <span className="material-symbols-outlined text-[16px]">category</span>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={language} onValueChange={setLanguage} disabled={creating}>
                  <SelectTrigger className={PILL_TRIGGER_CLASS}>
                    <span className="material-symbols-outlined text-[16px]">language</span>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={String(clipCount)} onValueChange={(v) => setClipCount(Number(v))} disabled={creating}>
                  <SelectTrigger className={PILL_TRIGGER_CLASS}>
                    <span className="material-symbols-outlined text-[16px]">format_list_numbered</span>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLIP_COUNTS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} clips
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={duration.label}
                  onValueChange={(v) => setDuration(DURATIONS.find((d) => d.label === v)!)}
                  disabled={creating}
                >
                  <SelectTrigger className={PILL_TRIGGER_CLASS}>
                    <span className="material-symbols-outlined text-[16px]">timer</span>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATIONS.map((d) => (
                      <SelectItem key={d.label} value={d.label}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {thumbnail && (
              <div className="flex w-full flex-col gap-2 lg:w-80">
                <span className="px-1 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">YouTube preview</span>
                <div className="glass-panel flex flex-col gap-2 overflow-hidden rounded-2xl p-2">
                  <div className="aspect-video w-full overflow-hidden rounded-xl">
                    <img src={thumbnail} alt="Video thumbnail" className="h-full w-full object-cover" />
                  </div>
                  <div className="flex items-center gap-2 truncate px-2 pb-1 text-[11px] text-on-surface">
                    <span className="material-symbols-outlined text-[14px] text-error">play_circle</span>
                    <span className="truncate">{youtubeUrl}</span>
                  </div>
                </div>
              </div>
            )}
          </form>
        </section>

        <section className="flex flex-1 flex-col gap-6">
          <div className="flex items-center justify-between border-b border-outline-variant/30 pb-4">
            <div className="flex items-center gap-4">
              <h3 className="text-headline-md font-bold text-on-surface">Highlights board</h3>
              <Badge variant="neutral">Waiting</Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setYoutubeUrl("");
                setExistingVideoId("");
                setError(null);
              }}
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
              New session
            </Button>
          </div>

          <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-8 rounded-3xl border border-outline-variant/30 bg-surface-bright/50 p-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-high text-outline shadow-inner">
              <span className="material-symbols-outlined text-3xl">auto_awesome_motion</span>
            </div>
            <div>
              <h4 className="mb-2 text-headline-md font-bold text-on-surface">No clips yet</h4>
              <p className="max-w-md text-body-md text-on-surface-variant">
                Paste a YouTube URL above and click <span className="font-semibold text-on-surface">"Find highlights"</span>. Reel Farmer
                will scan the transcript to extract the moments worth cutting.
              </p>
            </div>

            <div className="flex w-full max-w-3xl flex-col items-center gap-4 md:flex-row">
              {STEPS.map((step, i) => (
                <div key={step.num} className="flex w-full items-center gap-4">
                  <div className="flex items-center gap-4 rounded-xl bg-surface-bright px-4 py-2">
                    <span className="inner-glow flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container text-sm font-bold text-on-primary-container">
                      {step.num}
                    </span>
                    <div className="text-left">
                      <div className="text-label-md text-on-surface">{step.title}</div>
                      <div className="text-[11px] text-on-surface-variant">{step.desc}</div>
                    </div>
                  </div>
                  {i < STEPS.length - 1 && <span className="material-symbols-outlined hidden text-outline-variant md:block">arrow_forward</span>}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
