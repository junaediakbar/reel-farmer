import { useRef } from "react";
import { Button } from "./components/ui/button";

interface SourceVideoPlayerProps {
  runId: string;
  startSec: number;
  endSec: number;
  onDuration?: (durationSec: number) => void;
}

export function SourceVideoPlayer({ runId, startSec, endSec, onDuration }: SourceVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <section className="soft-shadow flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-6">
      <video
        ref={videoRef}
        src={`/api/runs/${runId}/video`}
        controls
        onLoadedMetadata={(e) => onDuration?.(e.currentTarget.duration)}
        className="w-full rounded-xl bg-black"
      />
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
