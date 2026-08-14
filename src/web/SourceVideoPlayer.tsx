import { useRef, type ReactNode, type RefObject } from "react";
import { Button } from "./components/ui/button";

interface SourceVideoPlayerProps {
  runId: string;
  startSec: number;
  endSec: number;
  onDuration?: (durationSec: number) => void;
  onTimeUpdate?: (currentTimeSec: number) => void;
  /** Rendered absolutely over the video (e.g. a caption style preview) — parent must be
   * `position: relative` with `containerType: "inline-size"` for cqw-based overlays to scale right. */
  overlay?: ReactNode;
  /** Lets a parent (e.g. RunDetail's trim trackpad) seek this same <video> while dragging, for a
   * live frame preview at the trim point instead of only on click. */
  videoRef?: RefObject<HTMLVideoElement>;
}

export function SourceVideoPlayer({ runId, startSec, endSec, onDuration, onTimeUpdate, overlay, videoRef: externalRef }: SourceVideoPlayerProps) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef ?? internalRef;

  return (
    <section className="soft-shadow flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-6">
      <div className="relative overflow-hidden rounded-xl" style={{ containerType: "inline-size" }}>
        <video
          ref={videoRef}
          src={`/api/runs/${runId}/video`}
          controls
          onLoadedMetadata={(e) => onDuration?.(e.currentTarget.duration)}
          onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
          className="w-full bg-black"
        />
        {overlay}
      </div>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (videoRef.current) videoRef.current.currentTime = startSec;
          }}
        >
          Preview start
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (videoRef.current) videoRef.current.currentTime = endSec;
          }}
        >
          Preview end
        </Button>
      </div>
    </section>
  );
}
