import { useRef } from "react";

interface ClipTimelineProps {
  durationSec: number;
  startSec: number;
  endSec: number;
  onChange: (startSec: number, endSec: number) => void;
}

/** Draggable start/end trim handles over the source video's duration, native Pointer Events — no drag library. */
export function ClipTimeline({ durationSec, startSec, endSec, onChange }: ClipTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  function secAtClientX(clientX: number): number {
    const track = trackRef.current;
    if (!track || durationSec <= 0) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * durationSec;
  }

  function startDrag(handle: "start" | "end") {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      function onMove(ev: PointerEvent) {
        const sec = secAtClientX(ev.clientX);
        if (handle === "start") onChange(Math.min(sec, endSec - 0.5), endSec);
        else onChange(startSec, Math.max(sec, startSec + 0.5));
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }

  const clampPct = (sec: number) => (durationSec > 0 ? Math.min(100, Math.max(0, (sec / durationSec) * 100)) : 0);
  const startPct = clampPct(startSec);
  const endPct = durationSec > 0 ? clampPct(endSec) : 100;

  return (
    <div className="relative mt-2 h-8" ref={trackRef}>
      <div className="absolute inset-x-0 top-3 h-2 rounded-full bg-surface-container" />
      <div
        className="absolute top-3 h-2 rounded-full bg-gradient-to-r from-primary to-primary-bright"
        style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
      />
      <div
        className="absolute top-1 -ml-3 h-6 w-6 cursor-ew-resize touch-none rounded-full border-2 border-primary bg-white"
        style={{ left: `${startPct}%` }}
        onPointerDown={startDrag("start")}
      />
      <div
        className="absolute top-1 -ml-3 h-6 w-6 cursor-ew-resize touch-none rounded-full border-2 border-primary bg-white"
        style={{ left: `${endPct}%` }}
        onPointerDown={startDrag("end")}
      />
    </div>
  );
}
