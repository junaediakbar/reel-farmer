import { useRef, useState } from "react";
import { ClipTimeline } from "./ClipTimeline";
import { Button } from "./components/ui/button";

interface SourceVideoPlayerProps {
  runId: string;
  startSec: number;
  endSec: number;
  onChange: (startSec: number, endSec: number) => void;
}

export function SourceVideoPlayer({ runId, startSec, endSec, onChange }: SourceVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);

  return (
    <section className="soft-shadow flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-6">
      <video
        ref={videoRef}
        src={`/api/runs/${runId}/video`}
        controls
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        className="w-full rounded-xl bg-black"
      />
      <ClipTimeline durationSec={duration} startSec={startSec} endSec={endSec} onChange={onChange} />
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
