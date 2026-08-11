import { useRef, useState } from "react";
import { ClipTimeline } from "./ClipTimeline";

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
    <section className="card source-video">
      <video ref={videoRef} src={`/api/runs/${runId}/video`} controls onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} />
      <ClipTimeline durationSec={duration} startSec={startSec} endSec={endSec} onChange={onChange} />
      <div className="clip-timeline-actions">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            if (videoRef.current) videoRef.current.currentTime = startSec;
          }}
        >
          Preview start
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            if (videoRef.current) videoRef.current.currentTime = endSec;
          }}
        >
          Preview end
        </button>
      </div>
    </section>
  );
}
