import { useEffect, useRef, useState } from "react";
import { DEFAULT_CAPTION_STYLE, splitCaptionLines, type CaptionGroup, type CaptionsFile, type CaptionStyle } from "../pipeline/types";
import { CAPTION_PRESETS, CAPTION_PRESET_NAMES } from "./captionPresets";
import { LANGUAGES } from "./languages";
import { Button } from "./components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Switch } from "./components/ui/switch";
import { cn } from "./lib/utils";

interface CaptionEditorProps {
  runId: string;
  clipId: string;
  onBack: () => void;
}

const PIXELS_PER_SEC = 60;

// Remotion renders the overlay at this native width (src/remotion/index.tsx) — every px value
// below must convert through this constant so the preview is a true scaled-down copy of the
// actual export, not an approximation. cqw (container query width) ties it to the preview box's
// real on-screen size instead of a guessed browser window, so it stays correct at any zoom/window size.
const RENDER_WIDTH_PX = 1080;
function cqw(px: number): string {
  return `${(px / RENDER_WIDTH_PX) * 100}cqw`;
}

const FONT_CHOICES = ["Plus Jakarta Sans", "Arial", "Georgia", "Verdana", "Courier New", "Comic Sans MS"];

const COLOR_SWATCHES = ["#ffffff", "#ffafd3", "#c0c1ff", "#0b1c30"];

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
    try {
      const res = await fetch(`/api/runs/${runId}/clips/${clipId}/captions/regenerate`, {
        method: "POST",
        body: JSON.stringify({ groups, style }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Regenerate failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
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
  const justifyContent = style.position === "top" ? "flex-start" : style.position === "center" ? "center" : "flex-end";

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
              {activeGroup && (
                <div
                  className="pointer-events-none absolute inset-0 flex flex-col items-center"
                  style={{ justifyContent, alignItems: "center", padding: cqw(48) }}
                >
                  <div
                    className="flex flex-col items-center"
                    style={{ rowGap: cqw(style.fontSize * (style.lineHeight - 1)), maxWidth: "90%" }}
                  >
                    {splitCaptionLines(activeGroup.words)
                      .filter((line) => line.length > 0)
                      .map((line, li) => (
                        <div key={li} className="flex flex-wrap justify-center gap-x-[0.4em]">
                          {line.map((w, i) => {
                            const isActive = style.animate && previewTime >= w.start && previewTime < w.end;
                            return (
                              <span
                                key={i}
                                style={{
                                  fontFamily: style.fontFamily,
                                  fontSize: cqw(style.fontSize),
                                  fontWeight: style.fontWeight,
                                  color: isActive ? style.activeColor : style.primaryColor,
                                  WebkitTextStroke: style.outline ? `${cqw(2)} rgba(0,0,0,0.6)` : undefined,
                                }}
                              >
                                {w.word}
                              </span>
                            );
                          })}
                        </div>
                      ))}
                  </div>
                </div>
              )}
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
              {/* Presets */}
              <div>
                <label className="mb-4 block text-label-md text-on-surface">Style Presets</label>
                <div className="grid grid-cols-3 gap-3">
                  {CAPTION_PRESET_NAMES.map((name) => {
                    const preset = CAPTION_PRESETS[name]!;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setStyle(preset)}
                        className={cn(
                          "aspect-square rounded-xl border-2 text-sm font-semibold transition-colors",
                          style.fontFamily === preset.fontFamily && style.position === preset.position && style.animate === preset.animate
                            ? "border-primary bg-surface-container-high text-primary"
                            : "border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container",
                        )}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Typography */}
              <div>
                <label className="mb-4 block text-label-md text-on-surface">Typography</label>
                <div className="flex flex-col gap-4">
                  <Select value={style.fontFamily} onValueChange={(v) => updateStyle({ fontFamily: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_CHOICES.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="flex rounded-lg border border-outline-variant bg-surface-container-lowest overflow-hidden">
                    {(["top", "center", "bottom"] as const).map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => updateStyle({ position: pos })}
                        className={cn(
                          "flex-1 py-2 text-sm font-semibold capitalize transition-colors",
                          style.position === pos ? "bg-primary-container text-on-primary-container" : "hover:bg-surface-container",
                        )}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Size */}
              <div>
                <div className="mb-2 flex justify-between">
                  <label className="text-label-sm text-on-surface-variant">Size</label>
                  <span className="text-label-sm text-primary">{style.fontSize}px</span>
                </div>
                <input
                  type="range"
                  min={12}
                  max={120}
                  value={style.fontSize}
                  onChange={(e) => updateStyle({ fontSize: Number(e.target.value) })}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-surface-container-highest accent-primary"
                />
              </div>

              {/* Weight */}
              <div>
                <div className="mb-2 flex justify-between">
                  <label className="text-label-sm text-on-surface-variant">Weight</label>
                  <span className="text-label-sm text-primary">{style.fontWeight}</span>
                </div>
                <input
                  type="range"
                  min={400}
                  max={900}
                  step={100}
                  value={style.fontWeight}
                  onChange={(e) => updateStyle({ fontWeight: Number(e.target.value) })}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-surface-container-highest accent-primary"
                />
              </div>

              {/* Line height */}
              <div>
                <div className="mb-2 flex justify-between">
                  <label className="text-label-sm text-on-surface-variant">Line Spacing</label>
                  <span className="text-label-sm text-primary">{style.lineHeight.toFixed(1)}×</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.1}
                  value={style.lineHeight}
                  onChange={(e) => updateStyle({ lineHeight: Number(e.target.value) })}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-surface-container-highest accent-primary"
                />
              </div>

              {/* Colors */}
              <div>
                <label className="mb-2 block text-label-md text-on-surface">Text Color</label>
                <div className="flex gap-3">
                  {COLOR_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Text color ${c}`}
                      onClick={() => updateStyle({ primaryColor: c })}
                      className={cn(
                        "h-8 w-8 rounded-full border border-outline-variant transition-transform hover:scale-110",
                        style.primaryColor === c && "ring-2 ring-primary ring-offset-2",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input
                    type="color"
                    aria-label="Custom text color"
                    value={style.primaryColor}
                    onChange={(e) => updateStyle({ primaryColor: e.target.value })}
                    className="h-8 w-8 cursor-pointer rounded-full border border-outline-variant bg-transparent p-0"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-label-md text-on-surface">Highlight Color</label>
                <div className="flex gap-3">
                  {COLOR_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Highlight color ${c}`}
                      onClick={() => updateStyle({ activeColor: c })}
                      className={cn(
                        "h-8 w-8 rounded-full border border-outline-variant transition-transform hover:scale-110",
                        style.activeColor === c && "ring-2 ring-primary ring-offset-2",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input
                    type="color"
                    aria-label="Custom highlight color"
                    value={style.activeColor}
                    onChange={(e) => updateStyle({ activeColor: e.target.value })}
                    className="h-8 w-8 cursor-pointer rounded-full border border-outline-variant bg-transparent p-0"
                  />
                </div>
              </div>

              {/* Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-label-md text-on-surface">Dynamic Animation</h4>
                  <p className="text-label-sm text-on-surface-variant">Highlight each word as it's spoken</p>
                </div>
                <Switch checked={style.animate} onCheckedChange={(checked) => updateStyle({ animate: checked })} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-label-md text-on-surface">Text Outline</h4>
                  <p className="text-label-sm text-on-surface-variant">Dark stroke around letters for readability</p>
                </div>
                <Switch checked={style.outline} onCheckedChange={(checked) => updateStyle({ outline: checked })} />
              </div>

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
            </div>
          </div>
        </div>
    </div>
  );
}
