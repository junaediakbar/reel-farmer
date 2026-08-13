import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router";
import { useAtom } from "jotai";
import { runsAtom, existingVideosAtom, licenseValidAtom, depsReadyAtom } from "./atoms";
import { RunDetail } from "./RunDetail";
import { CaptionEditor } from "./CaptionEditor";
import { LicenseGate } from "./LicenseGate";
import { Setup } from "./Setup";
import { Sidebar } from "./Sidebar";
import { Library } from "./Library";
import { Settings } from "./Settings";
import { RunsPage } from "./RunsPage";
import { CreateRunPage } from "./CreateRunPage";

function RunDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  if (!id) return <Navigate to="/runs" replace />;
  return (
    <RunDetail
      runId={id}
      onBack={() => navigate("/runs")}
      onDeleted={() => navigate("/runs")}
      onOpenCaptions={(clipId) => navigate(`/runs/${id}/clips/${clipId}/captions`)}
    />
  );
}

function CaptionEditorRoute() {
  const { id, clipId } = useParams<{ id: string; clipId: string }>();
  const navigate = useNavigate();
  if (!id || !clipId) return <Navigate to="/runs" replace />;
  return <CaptionEditor runId={id} clipId={clipId} onBack={() => navigate(`/runs/${id}`)} />;
}

export function App() {
  const [licenseValid, setLicenseValid] = useAtom(licenseValidAtom);
  const [depsReady, setDepsReady] = useAtom(depsReadyAtom);
  const [, setRuns] = useAtom(runsAtom);
  const [, setExistingVideos] = useAtom(existingVideosAtom);
  const navigate = useNavigate();

  useEffect(() => {
    async function refresh() {
      const res = await fetch("/api/runs");
      setRuns(await res.json());
    }
    refresh();
    fetch("/api/videos")
      .then((r) => r.json())
      .then(setExistingVideos);
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, [setRuns, setExistingVideos]);

  if (!licenseValid) return <LicenseGate onReady={() => setLicenseValid(true)} />;
  if (!depsReady) return <Setup onReady={() => setDepsReady(true)} />;

  return (
    <div className="flex min-h-screen">
      <Sidebar onCreateRun={() => navigate("/runs/new")} />
      <div className="min-w-0 flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/runs" replace />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/new" element={<CreateRunPage />} />
          <Route path="/runs/:id" element={<RunDetailRoute />} />
          <Route path="/runs/:id/clips/:clipId/captions" element={<CaptionEditorRoute />} />
          <Route path="/library" element={<Library />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/runs" replace />} />
        </Routes>
      </div>
    </div>
  );
}
