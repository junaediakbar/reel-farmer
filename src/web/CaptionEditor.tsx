import { useEffect, useState } from "react";
import type { CaptionGroup } from "../pipeline/types";

interface CaptionEditorProps {
  runId: string;
  clipId: string;
  onClose: () => void;
}

const PIXELS_PER_SEC = 60;

/** Extends word `wordIdx` in group `groupIdx` by `deltaSec` (clamped to a 0.05s min duration) and syncs the group's end to its last word. */
export function applyWordResize(groups: CaptionGroup[], groupIdx: number, wordIdx: number, deltaSec: number): CaptionGroup[] {
  return groups.map((g, gi) => {
    if (gi !== groupIdx) return g;
    const words = g.words.map((w, wi) => (wi === wordIdx ? { ...w, end: Math.max(w.start + 0.05, w.end + deltaSec) } : w));
    return { ...g, words, end: words[words.length - 1]!.end };
  });
}

export function CaptionEditor({ runId, clipId, onClose }: CaptionEditorProps) {
  const [groups, setGroups] = useState<CaptionGroup[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/runs/${runId}/clips/${clipId}/captions`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setGroups);
  }, [runId, clipId]);

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
        body: JSON.stringify({ groups }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Regenerate failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="card caption-editor" onClick={(e) => e.stopPropagation()}>
        <header className="caption-editor-header">
          <h2>Edit captions</h2>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="caption-groups">
          {groups.map((g, gi) => (
            <div key={gi} className="caption-group">
              <input className="caption-text-input" value={g.words.map((w) => w.word).join(" ")} onChange={(e) => updateGroupText(gi, e.target.value)} />
              <div className="caption-words">
                {g.words.map((w, wi) => (
                  <span key={wi} className="caption-word">
                    {w.word}
                    <span className="caption-word-resize" onPointerDown={startResize(gi, wi)} title="Drag to resize duration" />
                  </span>
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && <p className="empty">No captions yet — render this clip first.</p>}
        </div>
        {error && <p className="error-text">{error}</p>}
        <button type="button" className="btn-primary" onClick={regenerate} disabled={saving || groups.length === 0}>
          {saving ? "Regenerating…" : "Regenerate overlay"}
        </button>
      </section>
    </div>
  );
}
