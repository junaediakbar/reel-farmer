import { useEffect, useMemo, useRef, useState } from "react";
import {
  CLIP_STAGES,
  GLOBAL_STAGES,
  type ClipCandidate,
  type ClipProgress,
  type GlobalStage,
  type PipelineRun,
  type PreProductionOptions,
  type TokenUsage,
} from "../pipeline/types";
import { CAPTION_PRESETS, CAPTION_PRESET_NAMES } from "./captionPresets";
import { SourceVideoPlayer } from "./SourceVideoPlayer";
import { ClipTimeline } from "./ClipTimeline";
import { PreProductionPanel } from "./PreProductionPanel";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Badge, type BadgeProps } from "./components/ui/badge";

interface RunDetailData {
  run: PipelineRun;
  clips: ClipCandidate[];
  clipProgress: ClipProgress[];
  tokenUsage: TokenUsage | null;
}

export interface EditableClip extends ClipCandidate {
  selected: boolean;
}

function newCustomClip(): EditableClip {
  return {
    id: crypto.randomUUID(),
    title: "Custom clip",
    hookLine: "",
    startSec: 0,
    endSec: 30,
    reason: "manual",
    viralScore: 0,
    tags: [],
    selected: true,
  };
}

/** Parses a pasted JSON blob (single clip or array) into importable clips, throwing on missing numeric startSec/endSec. */
export function parseImportedClips(importText: string): EditableClip[] {
  const parsed = JSON.parse(importText) as unknown;
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((raw) => {
    const c = raw as Partial<ClipCandidate>;
    if (typeof c.startSec !== "number" || typeof c.endSec !== "number") {
      throw new Error("Each clip needs numeric startSec/endSec");
    }
    return {
      id: c.id ?? crypto.randomUUID(),
      title: c.title ?? "Imported clip",
      hookLine: c.hookLine ?? "",
      startSec: c.startSec,
      endSec: c.endSec,
      reason: c.reason ?? "imported",
      viralScore: c.viralScore ?? 0,
      tags: c.tags ?? [],
      selected: true,
    };
  });
}

interface RunDetailProps {
  runId: string;
  onBack: () => void;
  onDeleted: () => void;
  onOpenCaptions: (clipId: string) => void;
}

type ClipStatus = "failed" | "rendered" | "rendering" | "pending";

const RUN_STATUS_VARIANT: Record<PipelineRun["status"], BadgeProps["variant"]> = {
  completed: "success",
  failed: "error",
  running: "running",
  awaiting_selection: "running",
  pending: "neutral",
};

const CLIP_STATUS_VARIANT: Record<ClipStatus, BadgeProps["variant"]> = {
  failed: "error",
  rendered: "success",
  rendering: "running",
  pending: "neutral",
};

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Parses "m:ss" (or "mm:ss") back to seconds; null if the text isn't a valid timecode. */
function parseTimecode(value: string): number | null {
  const match = /^(\d+):([0-5]?\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** DOWNLOAD/TRANSCRIBE/IDENTIFY_CLIPS progress, from position in the fixed global stage order. */
function globalPhasePct(run: PipelineRun): number {
  if (!run.currentStage) return 0;
  const idx = GLOBAL_STAGES.indexOf(run.currentStage as GlobalStage);
  return idx === -1 ? 100 : Math.round(((idx + 1) / GLOBAL_STAGES.length) * 100);
}

/** Overall percent for whichever phase `run.currentStage` is in — global setup, or clip rendering. */
function currentPhasePct(run: PipelineRun, clips: ClipCandidate[], clipProgress: ClipProgress[]): number {
  return GLOBAL_STAGES.includes(run.currentStage as GlobalStage) ? globalPhasePct(run) : renderPhasePct(clips, clipProgress);
}

/** EXTRACT_CLIPS..COMPOSE_REEL progress against the full selected-clip x stage count, not just stages
 * that have already started — clip_progress rows are inserted lazily as each stage begins, so using
 * clipProgress.length as the denominator understated total work and made the percentage jump around. */
function renderPhasePct(clips: ClipCandidate[], clipProgress: ClipProgress[]): number {
  const total = clips.length * CLIP_STAGES.length;
  if (total === 0) return 0;
  const completed = clipProgress.filter((p) => p.status === "completed").length;
  return Math.round((completed / total) * 100);
}

export function RunDetail({ runId, onBack, onDeleted, onOpenCaptions }: RunDetailProps) {
  const [data, setData] = useState<RunDetailData | null>(null);
  const [editableClips, setEditableClips] = useState<EditableClip[]>([]);
  const [importText, setImportText] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [trimTargetId, setTrimTargetId] = useState<string | null>(null);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [captionStyleName, setCaptionStyleName] = useState<string>(CAPTION_PRESET_NAMES[0]!);
  const [preProduction, setPreProduction] = useState<PreProductionOptions>({});
  const scrubVideoRef = useRef<HTMLVideoElement>(null);

  async function refresh() {
    const res = await fetch(`/api/runs/${runId}`);
    if (!res.ok) return;
    const detail = (await res.json()) as RunDetailData;
    setData(detail);
    // Seed the editable list from the server once (first load) — after that it's local state
    // until "Render selected" overwrites clips.json, so we don't clobber in-progress edits.
    // AI candidates start unselected; the user opts in per clip before exporting.
    setEditableClips((prev) => (prev.length > 0 ? prev : detail.clips.map((c) => ({ ...c, selected: false }))));
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Keep the left-hand preview pointed at a clip that still exists — defaults to the first one.
  useEffect(() => {
    if (editableClips.length > 0 && !editableClips.some((c) => c.id === trimTargetId)) {
      setTrimTargetId(editableClips[0]!.id);
    }
  }, [editableClips, trimTargetId]);

  const progressByClip = useMemo(() => {
    const map = new Map<string, ClipProgress[]>();
    for (const p of data?.clipProgress ?? []) {
      const list = map.get(p.clipId) ?? [];
      list.push(p);
      map.set(p.clipId, list);
    }
    return map;
  }, [data]);

  const topViralScore = useMemo(() => Math.max(0, ...editableClips.map((c) => c.viralScore)), [editableClips]);

  function clipStatus(clipId: string): ClipStatus {
    const stages = progressByClip.get(clipId) ?? [];
    if (stages.some((s) => s.status === "failed")) return "failed";
    if (stages.length === 4 && stages.every((s) => s.status === "completed")) return "rendered";
    if (stages.some((s) => s.status === "running" || s.status === "completed")) return "rendering";
    return "pending";
  }

  function clipProgressPct(clipId: string): number {
    const stages = progressByClip.get(clipId) ?? [];
    const completed = stages.filter((s) => s.status === "completed").length;
    return Math.round((completed / CLIP_STAGES.length) * 100);
  }

  function updateClip(id: string, patch: Partial<EditableClip>) {
    setEditableClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function removeClip(id: string) {
    setEditableClips((prev) => prev.filter((c) => c.id !== id));
    // ?purge also drops it from clips.json server-side — otherwise it was only removed from
    // local state and would reappear (still an AI candidate) on the next refresh.
    fetch(`/api/runs/${runId}/clips/${id}?purge=1`, { method: "DELETE" });
  }

  function addCustomClip() {
    setEditableClips((prev) => [...prev, newCustomClip()]);
  }

  function importJson() {
    setImportError(null);
    try {
      const imported = parseImportedClips(importText);
      setEditableClips((prev) => [...prev, ...imported]);
      setImportText("");
      setImportOpen(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  async function renderSelected() {
    const selected = editableClips.filter((c) => c.selected).map(({ selected: _selected, ...clip }) => clip);
    if (selected.length === 0) return;
    setRendering(true);
    await fetch(`/api/runs/${runId}/select`, {
      method: "POST",
      body: JSON.stringify({ clips: selected, style: CAPTION_PRESETS[captionStyleName], preProduction }),
    });
    setRendering(false);
    refresh();
  }

  async function deleteRun() {
    await fetch(`/api/runs/${runId}`, { method: "DELETE" });
    onDeleted();
  }

  async function retryRun() {
    await fetch(`/api/runs/${runId}/retry`, { method: "POST" });
    refresh();
  }

  async function deleteClipRender(clipId: string) {
    await fetch(`/api/runs/${runId}/clips/${clipId}`, { method: "DELETE" });
    refresh();
  }

  if (!data) return <p className="p-6 text-on-surface-variant">Loading…</p>;
  const { run, tokenUsage } = data;
  const trimTarget = editableClips.find((c) => c.id === trimTargetId);
  const trimTargetIndex = editableClips.findIndex((c) => c.id === trimTargetId);
  // The source video's real duration can take a while to load (or never, for files without a leading moov atom) —
  // fall back to spanning the AI-identified clips so the trackpad stays usable in the meantime.
  const timelineDuration = sourceDuration > 0 ? sourceDuration : Math.max(60, ...editableClips.map((c) => c.endSec)) * 1.1;
  const canEdit = run.status === "awaiting_selection" || run.status === "running" || run.status === "completed";
  const selectedCount = editableClips.filter((c) => c.selected).length;

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-20 items-center justify-between gap-3 bg-surface/70 px-6 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to runs"
            className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-headline-md text-on-surface" title={run.title ?? run.videoUrl}>
              {run.title ?? run.videoUrl}
            </h2>
            <Badge variant={RUN_STATUS_VARIANT[run.status]}>{run.status.replace("_", " ")}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {run.status === "failed" && (
            <Button variant="ghost" size="sm" onClick={retryRun}>
              <span className="material-symbols-outlined text-[16px]">refresh</span>
              Retry
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={deleteRun}>
            <span className="material-symbols-outlined text-[16px]">delete</span>
            Delete run
          </Button>
          {canEdit && (
            <div className="flex items-center gap-2">
              <Select value={captionStyleName} onValueChange={setCaptionStyleName}>
                <SelectTrigger className="w-36" aria-label="Caption style">
                  <span className="material-symbols-outlined text-[16px]">text_fields</span>
                  <SelectValue placeholder="Caption style" />
                </SelectTrigger>
                <SelectContent>
                  {CAPTION_PRESET_NAMES.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="primary" onClick={renderSelected} disabled={rendering || run.status === "running" || selectedCount === 0}>
                <span className="material-symbols-outlined">movie</span>
                {rendering || run.status === "running" ? "Rendering…" : "Export Selected"}
              </Button>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-2 px-6 pt-4">
        {run.status === "running" && run.currentStage && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-on-surface-variant">
              Working: {run.currentStage} · {currentPhasePct(run, data.clips, data.clipProgress)}%
            </p>
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-container-high">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${currentPhasePct(run, data.clips, data.clipProgress)}%` }}
              />
            </div>
          </div>
        )}
        {run.errorMessage && <p className="text-sm text-error">{run.errorMessage}</p>}
        {tokenUsage && <p className="text-sm text-on-surface-variant">DeepSeek tokens used: {tokenUsage.totalTokens.toLocaleString()}</p>}
      </div>

      {!canEdit ? (
        <div className="flex flex-1 items-center justify-center p-24">
          <p className="text-on-surface-variant">Clips will appear here once the run reaches the selection phase.</p>
        </div>
      ) : (
        <div className="mx-auto grid w-full max-w-[1160px] grid-cols-12 gap-gutter px-6 pb-24 pt-6">
          {/* Left: preview + a trackpad showing every AI-identified clip along the source video */}
          <div className="col-span-12 flex flex-col gap-stack-md lg:col-span-8">
            {trimTarget ? (
              <div className="flex flex-col gap-3">
                <div className="glass-panel flex w-fit items-center gap-2 rounded-lg px-3 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-label-sm text-on-surface">
                    Clip {String(trimTargetIndex + 1).padStart(2, "0")} · {trimTarget.title}
                  </span>
                </div>
                <SourceVideoPlayer
                  runId={runId}
                  startSec={trimTarget.startSec}
                  endSec={trimTarget.endSec}
                  onDuration={setSourceDuration}
                  videoRef={scrubVideoRef}
                />
                <div className="soft-shadow flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4">
                  <h3 className="text-label-md text-on-surface-variant">Timeline Compilation</h3>
                  <ClipTimeline
                    durationSec={timelineDuration}
                    clips={editableClips.map((c) => ({ id: c.id, startSec: c.startSec, endSec: c.endSec, label: c.title }))}
                    activeId={trimTargetId}
                    onSelect={setTrimTargetId}
                    onChange={(id, startSec, endSec) => updateClip(id, { startSec, endSec })}
                    onScrub={(sec) => {
                      if (scrubVideoRef.current) scrubVideoRef.current.currentTime = sec;
                    }}
                  />
                </div>
                <PreProductionPanel runId={runId} value={preProduction} onChange={setPreProduction} />
              </div>
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-3xl border border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant">
                Add a clip to preview & trim it here.
              </div>
            )}
          </div>

          {/* Right: AI-identified candidates, selectable for export */}
          <div className="col-span-12 flex max-h-[calc(100vh-11rem)] flex-col overflow-hidden rounded-3xl border border-outline-variant/20 bg-surface-container-lowest shadow-sm lg:col-span-4">
            <div className="sticky top-0 z-10 border-b border-outline-variant/20 bg-surface-container-lowest p-6">
              <h2 className="text-headline-md text-on-surface">AI Selections</h2>
              <p className="mt-1 text-label-sm text-on-surface-variant">{editableClips.length} clips identified</p>
            </div>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              {editableClips.map((clip) => {
                const status = clipStatus(clip.id);
                const isTop = topViralScore > 0 && clip.viralScore === topViralScore;
                const isActive = clip.id === trimTargetId;
                return (
                  <div
                    key={clip.id}
                    onClick={() => setTrimTargetId(clip.id)}
                    className={`relative cursor-pointer rounded-2xl p-3 shadow-sm transition-colors ${
                      clip.selected
                        ? "glass-panel border-2 border-primary"
                        : "border border-outline-variant/30 bg-surface-container-lowest hover:border-primary/50"
                    } ${isActive ? "ring-2 ring-primary/30" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateClip(clip.id, { selected: !clip.selected });
                      }}
                      aria-label={clip.selected ? "Deselect clip" : "Select clip"}
                      className={`absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full shadow-md ${
                        clip.selected ? "bg-primary text-white" : "bg-surface-container-high text-on-surface-variant"
                      }`}
                    >
                      <span className="material-symbols-outlined icon-fill text-[16px]">
                        {clip.selected ? "check" : "add"}
                      </span>
                    </button>

                    <div className="flex gap-3">
                      <div className="relative h-32 w-24 shrink-0 overflow-hidden rounded-xl bg-surface-container-high">
                        {status === "rendered" ? (
                          <video
                            src={`/api/runs/${runId}/clips/${clip.id}/video`}
                            poster={`/api/runs/${runId}/clips/${clip.id}/thumbnail`}
                            muted
                            preload="metadata"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <img
                            src={`/api/runs/${runId}/clips/${clip.id}/preview-thumbnail`}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        )}
                        <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white backdrop-blur-sm">
                          {formatDuration(clip.endSec - clip.startSec)}
                        </span>
                      </div>

                      <div className="flex flex-1 flex-col justify-between py-1">
                        <div>
                          <input
                            value={clip.title}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => updateClip(clip.id, { title: e.target.value })}
                            title={clip.title}
                            className="w-full truncate bg-transparent text-label-md font-semibold text-on-surface focus:outline-none"
                          />
                          {clip.hookLine && <p className="mt-1 line-clamp-2 text-xs text-on-surface-variant">{clip.hookLine}</p>}
                          <div className="mt-2 flex flex-wrap gap-1">
                            {clip.tags.map((tag) => (
                              <Badge key={tag} variant="tag" className="text-[10px]">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        {isActive && (
                          <div className="mt-2 flex items-end gap-2" onClick={(e) => e.stopPropagation()}>
                            <label className="flex flex-col gap-0.5 text-[10px] font-semibold text-on-surface-variant">
                              Start
                              <Input
                                key={`start-${clip.id}-${clip.startSec}`}
                                type="text"
                                inputMode="numeric"
                                placeholder="mm:ss"
                                className="h-8 w-16 px-2 text-xs"
                                defaultValue={formatDuration(clip.startSec)}
                                onBlur={(e) => {
                                  const parsed = parseTimecode(e.target.value);
                                  if (parsed !== null) updateClip(clip.id, { startSec: parsed });
                                }}
                              />
                            </label>
                            <label className="flex flex-col gap-0.5 text-[10px] font-semibold text-on-surface-variant">
                              End
                              <Input
                                key={`end-${clip.id}-${clip.endSec}`}
                                type="text"
                                inputMode="numeric"
                                placeholder="mm:ss"
                                className="h-8 w-16 px-2 text-xs"
                                defaultValue={formatDuration(clip.endSec)}
                                onBlur={(e) => {
                                  const parsed = parseTimecode(e.target.value);
                                  if (parsed !== null) updateClip(clip.id, { endSec: parsed });
                                }}
                              />
                            </label>
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge variant={isTop ? "success" : "secondary"}>
                            <span className="material-symbols-outlined icon-fill">{isTop ? "local_fire_department" : "analytics"}</span>
                            {clip.viralScore}
                          </Badge>
                          <Badge variant={CLIP_STATUS_VARIANT[status]}>
                            {status}
                            {status === "rendering" ? ` ${clipProgressPct(clip.id)}%` : ""}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap justify-end gap-1">
                      {(status === "rendered" || status === "failed") && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenCaptions(clip.id);
                            }}
                          >
                            <span className="material-symbols-outlined text-[16px]">closed_caption</span>
                            Captions
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteClipRender(clip.id);
                            }}
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                            Delete render
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeClip(clip.id);
                        }}
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}
              {editableClips.length === 0 && <p className="p-2 text-sm text-on-surface-variant">No candidate clips yet.</p>}
            </div>

            <div className="border-t border-outline-variant/20 bg-surface-container-lowest/90 p-4 backdrop-blur-sm">
              <Button variant="ghost" className="w-full justify-center rounded-xl bg-surface-container-high" onClick={addCustomClip}>
                <span className="material-symbols-outlined">add</span>
                Add custom clip
              </Button>
              <button
                type="button"
                onClick={() => setImportOpen((v) => !v)}
                className="mt-2 w-full text-center text-xs font-semibold text-on-surface-variant hover:text-primary"
              >
                {importOpen ? "Cancel import" : "or import JSON…"}
              </button>
              {importOpen && (
                <div className="mt-2 flex flex-col gap-2">
                  <Textarea
                    placeholder="Paste a JSON array of clips to import…"
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                  />
                  <Button variant="ghost" size="sm" className="self-start" onClick={importJson}>
                    <span className="material-symbols-outlined text-[16px]">upload_file</span>
                    Import JSON
                  </Button>
                  {importError && <p className="text-sm text-error">{importError}</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
