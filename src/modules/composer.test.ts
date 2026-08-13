import { describe, expect, test } from "bun:test";
import { buildComposeFilterGraph } from "./composer";

describe("buildComposeFilterGraph", () => {
  test("no watermark uses the current colorkey filter string", () => {
    const graph = buildComposeFilterGraph();
    expect(graph.filterComplex).toBe(
      "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg];[1:v]colorkey=0x00ff00:0.02:0.65[fg];[bg][fg]overlay=0:0[v]",
    );
    expect(graph.finalLabel).toBe("v");
    expect(graph.extraInputCount).toBe(0);
  });

  test("watermark adds a positioned, opacity-adjusted overlay layer", () => {
    const graph = buildComposeFilterGraph({ imagePath: "/logo.png", position: "bottom-right", opacity: 0.5 });
    expect(graph.filterComplex).toContain("[2:v]scale=162:-1,format=rgba,colorchannelmixer=aa=0.5[wm2]");
    expect(graph.filterComplex).toContain("[v][wm2]overlay=main_w-overlay_w-24:main_h-overlay_h-24[vw]");
    expect(graph.finalLabel).toBe("vw");
    expect(graph.extraInputCount).toBe(1);
  });

  test("center position uses the centering expression", () => {
    const graph = buildComposeFilterGraph({ imagePath: "/logo.png", position: "center", opacity: 1 });
    expect(graph.filterComplex).toContain("overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[vw]");
  });

  test("ending watermark gates visibility with enable=gte(t, start)", () => {
    const graph = buildComposeFilterGraph(undefined, { imagePath: "/outro.png", position: "top-left", opacity: 1, durationSec: 3 }, 12.5);
    expect(graph.filterComplex).toContain("[2:v]scale=162:-1,format=rgba,colorchannelmixer=aa=1[wm2]");
    expect(graph.filterComplex).toContain("overlay=24:24:enable='gte(t,12.50)'[ve]");
    expect(graph.finalLabel).toBe("ve");
    expect(graph.extraInputCount).toBe(1);
  });

  test("watermark + ending watermark stack as two extra inputs in order", () => {
    const graph = buildComposeFilterGraph(
      { imagePath: "/logo.png", position: "top-left", opacity: 0.8 },
      { imagePath: "/outro.png", position: "top-left", opacity: 1, durationSec: 3 },
      10,
    );
    expect(graph.filterComplex).toContain("[2:v]"); // watermark is input 2
    expect(graph.filterComplex).toContain("[3:v]"); // ending watermark is input 3
    expect(graph.filterComplex).toContain("[v][wm2]overlay=24:24[vw]");
    expect(graph.filterComplex).toContain("[vw][wm3]overlay=24:24:enable='gte(t,10.00)'[ve]");
    expect(graph.finalLabel).toBe("ve");
    expect(graph.extraInputCount).toBe(2);
  });
});
