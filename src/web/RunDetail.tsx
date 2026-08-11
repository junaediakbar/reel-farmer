import { useEffect, useMemo, useState } from "react";
import type { ClipCandidate, ClipProgress, PipelineRun, TokenUsage } from "../pipeline/types";
import { CaptionEditor } from "./CaptionEditor";
import { SourceVideoPlayer } from "./SourceVideoPlayer";

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

  function clipStatus(clipId: string): "failed" | "rendered" | "rendering" | "pending" {
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

  async function deleteClipRender(clipId: string) {
    await fetch(`/api/runs/${runId}/clips/${clipId}`, { method: "DELETE" });
    refresh();
  }

  if (!data) return <p className="empty">Loading…</p>;
  const { run, tokenUsage } = data;
  const trimTarget = editableClips.find((c) => c.id === trimTargetId);
  const canEdit = run.status === "awaiting_selection" || run.status === "running" || run.status === "completed";

  return (
    <div className="page">
      <button type="button" className="btn-ghost" onClick={onBack}>
        &larr; Back to runs
      </button>

      <header className="page-header run-detail-header">
        <div>
          <h1>{run.title ?? run.videoUrl}</h1>
          <span className={`status-badge status-${run.status}`}>{run.status.replace("_", " ")}</span>
        </div>
        <button type="button" className="btn-ghost" onClick={deleteRun}>
          Delete run
        </button>
      </header>

      {run.status === "running" && <p className="run-stage">Working: {run.currentStage}</p>}
      {run.errorMessage && <p className="error-text">{run.errorMessage}</p>}
      {tokenUsage && <p className="run-stage">DeepSeek tokens used: {tokenUsage.totalTokens.toLocaleString()}</p>}

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

          <section className="card">
            <h2>Candidate clips</h2>
            <ul className="clip-list">
              {editableClips.map((clip) => (
                <li key={clip.id} className="clip-row">
                  <input type="checkbox" checked={clip.selected} onChange={(e) => updateClip(clip.id, { selected: e.target.checked })} />
                  <div className="clip-info">
                    <input className="clip-title-input" value={clip.title} onChange={(e) => updateClip(clip.id, { title: e.target.value })} />
                    {clip.hookLine && <p className="clip-hook">{clip.hookLine}</p>}
                    <div className="clip-trim">
                      <label>
                        Start
                        <input type="number" value={clip.startSec} onChange={(e) => updateClip(clip.id, { startSec: Number(e.target.value) })} />
                      </label>
                      <label>
                        End
                        <input type="number" value={clip.endSec} onChange={(e) => updateClip(clip.id, { endSec: Number(e.target.value) })} />
                      </label>
                      <button type="button" className="btn-ghost" onClick={() => setTrimTargetId(clip.id)}>
                        Trim on timeline
                      </button>
                    </div>
                    <span className={`status-badge status-${clipStatus(clip.id)}`}>{clipStatus(clip.id)}</span>
                    {(clipStatus(clip.id) === "rendered" || clipStatus(clip.id) === "failed") && (
                      <>
                        <button type="button" className="btn-ghost" onClick={() => setActiveClipId(clip.id)}>
                          Edit captions
                        </button>
                        <button type="button" className="btn-ghost" onClick={() => deleteClipRender(clip.id)}>
                          Delete render
                        </button>
                      </>
                    )}
                  </div>
                  <button type="button" className="btn-ghost" onClick={() => removeClip(clip.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            <button type="button" className="btn-ghost" onClick={addCustomClip}>
              + Add custom clip
            </button>

            <div className="import-json">
              <textarea placeholder="Paste a JSON array of clips to import…" value={importText} onChange={(e) => setImportText(e.target.value)} />
              <button type="button" className="btn-ghost" onClick={importJson}>
                Import JSON
              </button>
              {importError && <p className="error-text">{importError}</p>}
            </div>

            <button type="button" className="btn-primary" onClick={renderSelected} disabled={rendering || run.status === "running"}>
              {rendering || run.status === "running" ? "Rendering…" : "Render selected"}
            </button>
          </section>
        </>
      )}

      {activeClipId && <CaptionEditor runId={runId} clipId={activeClipId} onClose={() => setActiveClipId(null)} />}
    </div>
  );
}
