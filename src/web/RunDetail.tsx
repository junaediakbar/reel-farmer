import { useEffect, useMemo, useState } from "react";
import type { ClipCandidate, ClipProgress, PipelineRun, TokenUsage } from "../pipeline/types";
import { CaptionEditor } from "./CaptionEditor";
import { SourceVideoPlayer } from "./SourceVideoPlayer";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
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

export function RunDetail({ runId, onBack, onDeleted }: RunDetailProps) {
  const [data, setData] = useState<RunDetailData | null>(null);
  const [editableClips, setEditableClips] = useState<EditableClip[]>([]);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [trimTargetId, setTrimTargetId] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/runs/${runId}`);
    if (!res.ok) return;
    const detail = (await res.json()) as RunDetailData;
    setData(detail);
    // Seed the editable list from the server once (first load) — after that it's local state
    // until "Render selected" overwrites clips.json, so we don't clobber in-progress edits.
    setEditableClips((prev) => (prev.length > 0 ? prev : detail.clips.map((c) => ({ ...c, selected: true }))));
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

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

  function updateClip(id: string, patch: Partial<EditableClip>) {
    setEditableClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function removeClip(id: string) {
    setEditableClips((prev) => prev.filter((c) => c.id !== id));
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
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  async function renderSelected() {
    const selected = editableClips.filter((c) => c.selected).map(({ selected: _selected, ...clip }) => clip);
    if (selected.length === 0) return;
    setRendering(true);
    await fetch(`/api/runs/${runId}/select`, { method: "POST", body: JSON.stringify(selected) });
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
  const canEdit = run.status === "awaiting_selection" || run.status === "running" || run.status === "completed";

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-10 flex h-20 items-center justify-between gap-3 bg-surface/70 px-6 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to runs"
            className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <h2 className="text-headline-md text-on-surface">{run.title ?? run.videoUrl}</h2>
            <Badge variant={RUN_STATUS_VARIANT[run.status]}>{run.status.replace("_", " ")}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
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
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-stack-md px-6 pb-24">
        {run.status === "running" && <p className="text-sm text-on-surface-variant">Working: {run.currentStage}</p>}
        {run.errorMessage && <p className="text-sm text-error">{run.errorMessage}</p>}
        {tokenUsage && <p className="text-sm text-on-surface-variant">DeepSeek tokens used: {tokenUsage.totalTokens.toLocaleString()}</p>}

        {canEdit && (
          <>
            {trimTarget && (
              <SourceVideoPlayer
                runId={runId}
                startSec={trimTarget.startSec}
                endSec={trimTarget.endSec}
                onChange={(startSec, endSec) => updateClip(trimTarget.id, { startSec, endSec })}
              />
            )}

            <section className="soft-shadow flex flex-col gap-4 rounded-2xl bg-surface-container-lowest p-6">
              <h2 className="text-headline-md text-on-surface">Candidate clips</h2>
              <ul className="flex flex-col gap-4">
                {editableClips.map((clip) => {
                  const status = clipStatus(clip.id);
                  const isTop = topViralScore > 0 && clip.viralScore === topViralScore;
                  return (
                    <li key={clip.id} className="flex items-start gap-3 rounded-xl bg-surface-container-low p-4">
                      <input
                        type="checkbox"
                        checked={clip.selected}
                        onChange={(e) => updateClip(clip.id, { selected: e.target.checked })}
                        className="mt-3 h-[18px] w-[18px] accent-primary"
                      />
                      <div className="flex flex-1 flex-col gap-2">
                        <input
                          value={clip.title}
                          onChange={(e) => updateClip(clip.id, { title: e.target.value })}
                          className="bg-transparent text-base font-bold text-on-surface focus:outline-none"
                        />
                        {clip.hookLine && <p className="text-sm text-on-surface-variant">{clip.hookLine}</p>}
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
                            Start
                            <Input
                              type="number"
                              className="h-9 w-24"
                              value={clip.startSec}
                              onChange={(e) => updateClip(clip.id, { startSec: Number(e.target.value) })}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
                            End
                            <Input
                              type="number"
                              className="h-9 w-24"
                              value={clip.endSec}
                              onChange={(e) => updateClip(clip.id, { endSec: Number(e.target.value) })}
                            />
                          </label>
                          <Button variant="ghost" size="sm" onClick={() => setTrimTargetId(clip.id)}>
                            <span className="material-symbols-outlined text-[16px]">content_cut</span>
                            Trim on timeline
                          </Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={CLIP_STATUS_VARIANT[status]}>{status}</Badge>
                          <Badge variant={isTop ? "success" : "secondary"}>
                            <span className="material-symbols-outlined icon-fill">{isTop ? "local_fire_department" : "analytics"}</span>
                            {clip.viralScore}
                          </Badge>
                          {clip.tags.map((tag) => (
                            <Badge key={tag} variant="tag">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        {(status === "rendered" || status === "failed") && (
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setActiveClipId(clip.id)}>
                              <span className="material-symbols-outlined text-[16px]">closed_caption</span>
                              Edit captions
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => deleteClipRender(clip.id)}>
                              <span className="material-symbols-outlined text-[16px]">delete</span>
                              Delete render
                            </Button>
                          </div>
                        )}
                      </div>
                      <Button variant="icon" size="icon" onClick={() => removeClip(clip.id)} aria-label="Remove clip">
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </Button>
                    </li>
                  );
                })}
              </ul>

              <Button variant="ghost" size="sm" className="self-start" onClick={addCustomClip}>
                <span className="material-symbols-outlined text-[16px]">add</span>
                Add custom clip
              </Button>

              <div className="flex flex-col gap-2">
                <Textarea placeholder="Paste a JSON array of clips to import…" value={importText} onChange={(e) => setImportText(e.target.value)} />
                <Button variant="ghost" size="sm" className="self-start" onClick={importJson}>
                  <span className="material-symbols-outlined text-[16px]">upload_file</span>
                  Import JSON
                </Button>
                {importError && <p className="text-sm text-error">{importError}</p>}
              </div>

              <Button variant="primary" onClick={renderSelected} disabled={rendering || run.status === "running"} className="self-start">
                <span className="material-symbols-outlined">movie</span>
                {rendering || run.status === "running" ? "Rendering…" : "Render selected"}
              </Button>
            </section>
          </>
        )}

        {activeClipId && <CaptionEditor runId={runId} clipId={activeClipId} onClose={() => setActiveClipId(null)} />}
      </div>
    </div>
  );
}
