import { useRef } from "react";

export interface ClipSegment {
  id: string;
  startSec: number;
  endSec: number;
  label: string;
}

interface ClipTimelineProps {
  durationSec: number;
  clips: ClipSegment[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onChange: (id: string, startSec: number, endSec: number) => void;
}

/** Overview track of every AI-identified clip positioned along the source video's duration. Only the active
 * clip exposes drag handles — dragging or clicking a segment keeps the trackpad and the AI Selections card in sync
 * via the shared activeId/onSelect state in RunDetail. Native Pointer Events, no drag library. */
export function ClipTimeline({ durationSec, clips, activeId, onSelect, onChange }: ClipTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  function secAtClientX(clientX: number): number {
    const track = trackRef.current;
    if (!track || durationSec <= 0) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * durationSec;
  }

  function startDrag(clip: ClipSegment, handle: "start" | "end") {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      function onMove(ev: PointerEvent) {
        const sec = secAtClientX(ev.clientX);
        if (handle === "start") onChange(clip.id, Math.min(sec, clip.endSec - 0.5), clip.endSec);
        else onChange(clip.id, clip.startSec, Math.max(sec, clip.startSec + 0.5));
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }

  const pct = (sec: number) => (durationSec > 0 ? Math.min(100, Math.max(0, (sec / durationSec) * 100)) : 0);

  return (
    <div ref={trackRef} className="relative h-14 w-full rounded-xl bg-surface-container-low">
      {clips.map((clip) => {
        const isActive = clip.id === activeId;
        const left = pct(clip.startSec);
        const width = Math.max(0.6, pct(clip.endSec) - left);
        return (
          <div
            key={clip.id}
            onClick={() => onSelect(clip.id)}
            title={clip.label}
            className={`absolute top-1/2 h-9 -translate-y-1/2 cursor-pointer overflow-hidden rounded-lg transition-colors ${
              isActive ? "z-10 bg-primary ring-2 ring-primary ring-offset-1 ring-offset-surface-container-low" : "bg-primary/30 hover:bg-primary/50"
            }`}
            // minWidth in px (not just a %-based floor) keeps short clips tappable — on a long
            // source video a 0.6%-wide segment can render at just a few px, under any reasonable
            // touch target size.
            style={{ left: `${left}%`, width: `${width}%`, minWidth: "28px" }}
          >
            <span className="block truncate px-2 text-[10px] font-semibold leading-9 text-white">{clip.label}</span>
            {isActive && (
              <>
                <div
                  className="absolute -left-1.5 top-1/2 h-7 w-3 -translate-y-1/2 cursor-ew-resize touch-none rounded-full border-2 border-primary bg-white"
                  onPointerDown={startDrag(clip, "start")}
                />
                <div
                  className="absolute -right-1.5 top-1/2 h-7 w-3 -translate-y-1/2 cursor-ew-resize touch-none rounded-full border-2 border-primary bg-white"
                  onPointerDown={startDrag(clip, "end")}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
