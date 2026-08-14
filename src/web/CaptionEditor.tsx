import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_CAPTION_STYLE,
  type CaptionGroup,
  type CaptionsFile,
  type CaptionStyle,
  type ClipProgress,
} from "../pipeline/types";
import { CaptionOverlayPreview } from "./CaptionOverlayPreview";
import { CaptionStyleControls } from "./CaptionStyleControls";
import { LANGUAGES } from "./languages";
import { Button } from "./components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";

interface CaptionEditorProps {
  runId: string;
  clipId: string;
  onBack: () => void;
}

const PIXELS_PER_SEC = 60;

// The two checkpoint stages `regenerate()` re-runs (skips EXTRACT_CLIPS/REMOVE_SILENCE) — polled
// to drive the progress bar while the render is in flight.
const REGEN_STAGES = ["GENERATE_CAPTIONS", "COMPOSE_REEL"] as const;

/** Extends word `wordIdx` in group `groupIdx` by `deltaSec` (clamped to a 0.05s min duration) and syncs the group's end to its last word. */
export function applyWordResize(groups: CaptionGroup[], groupIdx: number, wordIdx: number, deltaSec: number): CaptionGroup[] {
  return groups.map((g, gi) => {
    if (gi !== groupIdx) return g;
    const words = g.words.map((w, wi) => (wi === wordIdx ? { ...w, end: Math.max(w.start + 0.05, w.end + deltaSec) } : w));
    return { ...g, words, end: words[words.length - 1]!.end };
  });
}

export function CaptionEditor({ runId, clipId, onBack }: CaptionEditorProps) {
  const [groups, setGroups] = useState<CaptionGroup[]>([]);
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);
  const [saving, setSaving] = useState(false);
  const [regenPct, setRegenPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewTime, setPreviewTime] = useState(0);
  const [language, setLanguage] = useState("auto");
  const [retranscribing, setRetranscribing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    fetch(`/api/runs/${runId}/clips/${clipId}/captions`)
      .then((r) => (r.ok ? r.json() : { groups: [], style: DEFAULT_CAPTION_STYLE }))
      .then((data: CaptionsFile) => {
        setGroups(data.groups ?? []);
        setStyle({ ...DEFAULT_CAPTION_STYLE, ...data.style });
      });
  }, [runId, clipId]);

  function updateStyle(patch: Partial<CaptionStyle>) {
    setStyle((prev) => ({ ...prev, ...patch }));
  }

  function updateGroupText(groupIdx: number, text: string) {
    const newWords = text.trim().split(/\s+/).filter(Boolean);
    setGroups((prev) =>
      prev.map((g, gi) => {
        if (gi !== groupIdx) return g;
        return { ...g, words: g.words.map((w, i) => ({ ...w, word: newWords[i] ?? w.word })) };
      }),
    );
  }

  function resizeWordEnd(groupIdx: number, wordIdx: number, deltaSec: number) {
    setGroups((prev) => applyWordResize(prev, groupIdx, wordIdx, deltaSec));
  }

  function startResize(groupIdx: number, wordIdx: number) {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      let lastX = e.clientX;
      function onMove(ev: PointerEvent) {
        const deltaSec = (ev.clientX - lastX) / PIXELS_PER_SEC;
        lastX = ev.clientX;
        resizeWordEnd(groupIdx, wordIdx, deltaSec);
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }

  async function regenerate() {
    setSaving(true);
    setError(null);
    setRegenPct(0);
    // Both stages are typically already "completed" from the original render, so only count a
    // stage once it finishes *after* this click — otherwise the bar would start at 100%.
    const startedAt = new Date().toISOString();
    const poll = setInterval(async () => {
      const r = await fetch(`/api/runs/${runId}`);
      if (!r.ok) return;
      const { clipProgress } = (await r.json()) as { clipProgress: ClipProgress[] };
      const done = clipProgress.filter(
        (p) =>
          p.clipId === clipId &&
          REGEN_STAGES.includes(p.stage as (typeof REGEN_STAGES)[number]) &&
          p.status === "completed" &&
          (p.completedAt ?? "") >= startedAt,
      ).length;
      setRegenPct(Math.round((done / REGEN_STAGES.length) * 100));
    }, 1000);
    try {
      const res = await fetch(`/api/runs/${runId}/clips/${clipId}/captions/regenerate`, {
        method: "POST",
        body: JSON.stringify({ groups, style }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Regenerate failed");
      setRegenPct(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(poll);
      setSaving(false);
    }
  }

  /** Re-runs Whisper on this clip's own audio in `language`, replacing the current word groups —
   * for when the run's original language selection was wrong and edited text alone can't fix it. */
  async function retranscribe() {
    setRetranscribing(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/clips/${clipId}/captions/retranscribe`, {
        method: "POST",
        body: JSON.stringify({ language, style }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Retranscribe failed");
      const captions = (await fetch(`/api/runs/${runId}/clips/${clipId}/captions`).then((r) => r.json())) as CaptionsFile;
      setGroups(captions.groups ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetranscribing(false);
    }
  }

  // Falls back to the first group so style/font/size edits are visible immediately, before the
  // video has been played to a timestamp that falls inside a caption's own [start, end) range.
  const activeGroup = groups.find((g) => previewTime >= g.start && previewTime < g.end) ?? groups[0];

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-20 items-center gap-3 bg-surface/70 px-6 backdrop-blur-xl">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to run"
          className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h2 className="text-headline-md text-on-surface">Caption Editor</h2>
      </header>

      <div className="flex h-[calc(100vh-5rem)] gap-gutter overflow-hidden p-gutter">
          {/* Preview */}
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl bg-surface-container-lowest soft-shadow p-6">
            <div
              className="relative aspect-[9/16] h-full max-h-full overflow-hidden rounded-[32px] border-[6px] border-surface-container-high bg-black shadow-2xl"
              style={{ containerType: "inline-size" }}
            >
              <video
                ref={videoRef}
                src={`/api/runs/${runId}/clips/${clipId}/desilenced`}
                controls
                muted
                onTimeUpdate={(e) => setPreviewTime(e.currentTarget.currentTime)}
                className="h-full w-full object-cover"
              />
              <CaptionOverlayPreview group={activeGroup} style={style} previewTime={previewTime} />
            </div>
            <p className="text-label-sm text-on-surface-variant">Live preview — footage before captions are rendered in</p>
          </div>

          {/* Settings panel */}
          <div className="glass-panel flex w-[380px] shrink-0 flex-col overflow-hidden rounded-3xl">
            <div className="border-b border-surface-variant bg-white/50 p-6">
              <h3 className="text-headline-md font-bold text-on-surface">Caption Styles</h3>
              <p className="mt-1 text-label-sm text-on-surface-variant">Customize your text overlays</p>
            </div>

            <div className="flex flex-1 flex-col gap-8 overflow-y-auto p-6">
              <CaptionStyleControls style={style} onChange={updateStyle} />

              {/* Word timing / text */}
              <div>
                <label className="mb-4 block text-label-md text-on-surface">Caption Text</label>
                <div className="flex flex-col gap-3">
                  {groups.map((g, gi) => (
                    <div key={gi} className="flex flex-col gap-2 rounded-lg bg-surface-container-low p-3">
                      <input
                        className="bg-transparent text-sm font-semibold text-on-surface focus:outline-none"
                        value={g.words.map((w) => w.word).join(" ")}
                        onChange={(e) => updateGroupText(gi, e.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        {g.words.map((w, wi) => (
                          <span
                            key={wi}
                            className="relative inline-flex items-center rounded-full border border-outline-variant bg-surface-container-lowest py-1 pl-2.5 pr-5 text-sm"
                          >
                            {w.word}
                            <span
                              className="absolute bottom-0.5 right-0.5 top-0.5 w-2.5 cursor-ew-resize touch-none rounded-full bg-primary opacity-40 hover:opacity-80"
                              onPointerDown={startResize(gi, wi)}
                              title="Drag to resize duration"
                            />
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {groups.length === 0 && <p className="text-sm text-on-surface-variant">No captions yet — render this clip first.</p>}
                </div>
              </div>
            </div>

            <div className="border-t border-outline-variant/30 p-4">
              {error && <p className="mb-2 text-sm text-error">{error}</p>}

              <div className="mb-3 flex flex-col gap-2 rounded-lg bg-surface-container-low p-3">
                <label className="text-label-sm text-on-surface-variant">Wrong language? Re-transcribe this clip</label>
                <div className="flex gap-2">
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger className="flex-1">
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
                  <Button
                    variant="outline"
                    onClick={retranscribe}
                    disabled={retranscribing || groups.length === 0}
                    className="shrink-0"
                  >
                    <span className="material-symbols-outlined text-[16px]">translate</span>
                    {retranscribing ? "Transcribing…" : "Retranscribe"}
                  </Button>
                </div>
              </div>

              <Button variant="primary" onClick={regenerate} disabled={saving || groups.length === 0} className="w-full justify-center">
                <span className="material-symbols-outlined">auto_awesome</span>
                {saving ? "Regenerating…" : "Regenerate overlay"}
              </Button>
              {saving && (
                <progress value={regenPct} max={100} className="h-1.5 w-full overflow-hidden rounded-full accent-primary [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-surface-container-high [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:transition-[width]" />
              )}
            </div>
          </div>
        </div>
    </div>
  );
}
