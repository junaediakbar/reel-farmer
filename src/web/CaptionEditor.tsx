import { useEffect, useState } from "react";
import type { CaptionGroup } from "../pipeline/types";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Button } from "./components/ui/button";

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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit captions</DialogTitle>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </DialogClose>
        </DialogHeader>

        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="mx-auto w-40 shrink-0 overflow-hidden rounded-2xl border-4 border-surface-container-high bg-black sm:mx-0">
            <video
              src={`/api/runs/${runId}/clips/${clipId}/video`}
              controls
              muted
              className="aspect-[9/16] w-full object-cover"
            />
          </div>

          <div className="flex flex-1 flex-col gap-4">
            <div className="flex max-h-96 flex-col gap-4 overflow-y-auto pr-1">
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
              {groups.length === 0 && <p className="text-on-surface-variant">No captions yet — render this clip first.</p>}
            </div>
            {error && <p className="text-sm text-error">{error}</p>}
            <Button variant="primary" onClick={regenerate} disabled={saving || groups.length === 0} className="self-start">
              <span className="material-symbols-outlined">auto_awesome</span>
              {saving ? "Regenerating…" : "Regenerate overlay"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
