import { atom } from "jotai";
import type { PipelineRun } from "../pipeline/types";

export interface ExistingVideo {
  videoId: string;
  title: string;
}

export const runsAtom = atom<PipelineRun[]>([]);
export const existingVideosAtom = atom<ExistingVideo[]>([]);
export const licenseValidAtom = atom(false);
export const depsReadyAtom = atom(false);
