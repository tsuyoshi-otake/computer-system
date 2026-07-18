import { describe, expect, it } from "vitest";

import {
  CRT_PROFILES,
  CURVATURE_INVERSE_ITERATIONS,
  DEFAULT_CURVATURE_PERCENT,
  DEFAULT_TERMINAL_PRESENTATION,
  MAX_CURVATURE_PERCENT,
  MIN_CURVATURE_PERCENT,
  SCREEN_SHAPES,
  curvatureDisplacementChannels,
  curvatureScaleFromPercent,
  displayPointToSource,
  normalizeCurvaturePercent,
  normalizeTerminalPresentation,
  sourcePointToDisplay,
  terminalCellFromDisplayPoint,
  terminalPresentationAttributes,
} from "../../web/terminal-presentation.js";

describe("Web Terminal presentation", () => {
  it("publishes the exact profiles, shapes, and active-tab defaults", () => {
    expect(CRT_PROFILES).toEqual(["off", "subtle", "arcade", "shadow-mask"]);
    expect(SCREEN_SHAPES).toEqual(["flat", "curved"]);
    expect(MIN_CURVATURE_PERCENT).toBe(0);
    expect(DEFAULT_CURVATURE_PERCENT).toBe(5);
    expect(MAX_CURVATURE_PERCENT).toBe(30);
    expect(DEFAULT_TERMINAL_PRESENTATION).toEqual({
      curvaturePercent: 5,
      profile: "arcade",
      shape: "flat",
    });
    expect(Object.isFrozen(DEFAULT_TERMINAL_PRESENTATION)).toBe(true);
  });

  it("normalizes malformed and partial state without storage", () => {
    expect(normalizeTerminalPresentation(undefined)).toEqual({
      curvaturePercent: 5,
      profile: "arcade",
      shape: "flat",
    });
    expect(
      normalizeTerminalPresentation({ profile: "subtle", shape: "fishbowl" }),
    ).toEqual({ curvaturePercent: 5, profile: "subtle", shape: "flat" });
    expect(
      terminalPresentationAttributes({
        profile: "shadow-mask",
        shape: "curved",
      }),
    ).toEqual({
      "data-curvature-percent": "5",
      "data-crt-profile": "shadow-mask",
      "data-screen-shape": "curved",
    });
  });

  it("clamps and rounds curvature to one bounded slider step", () => {
    expect(normalizeCurvaturePercent(undefined)).toBe(5);
    expect(normalizeCurvaturePercent("12.6")).toBe(13);
    expect(normalizeCurvaturePercent(-50)).toBe(0);
    expect(normalizeCurvaturePercent(80)).toBe(30);
    expect(curvatureScaleFromPercent(18)).toBe(0.18);
    expect(curvatureScaleFromPercent(80)).toBe(0.3);
    expect(
      normalizeTerminalPresentation({
        curvaturePercent: 22.4,
        profile: "off",
        shape: "curved",
      }),
    ).toEqual({ curvaturePercent: 22, profile: "off", shape: "curved" });
  });

  it("keeps flat presentation coordinates unchanged", () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ]) {
      expect(displayPointToSource(point, "flat")).toEqual(point);
      expect(sourcePointToDisplay(point, "flat")).toEqual(point);
    }
  });

  it("round-trips curved coordinates with one fixed inverse bound", () => {
    expect(CURVATURE_INVERSE_ITERATIONS).toBe(14);
    const cellCenters = [
      { x: 0.5, y: 0.5 },
      { x: 0.5 / 80, y: 0.5 },
      { x: 79.5 / 80, y: 0.5 },
      { x: 0.5, y: 0.5 / 25 },
      { x: 0.5, y: 24.5 / 25 },
      { x: 0.5 / 80, y: 0.5 / 25 },
      { x: 79.5 / 80, y: 0.5 / 25 },
      { x: 0.5 / 80, y: 24.5 / 25 },
      { x: 79.5 / 80, y: 24.5 / 25 },
    ];

    for (const curvaturePercent of [0, 1, 5, 18, 30]) {
      for (const source of cellCenters) {
        const displayed = sourcePointToDisplay(
          source,
          "curved",
          curvaturePercent,
        );
        expect(displayed).toBeDefined();
        const roundTrip = displayPointToSource(
          displayed,
          "curved",
          curvaturePercent,
        );
        expect(roundTrip?.x).toBeCloseTo(source.x, 4);
        expect(roundTrip?.y).toBeCloseTo(source.y, 4);
      }
    }
  });

  it("maps flat and curved pointer positions into bounded 80x25 cells", () => {
    expect(
      terminalCellFromDisplayPoint({
        columns: 80,
        point: { x: 0.5, y: 0.5 },
        rows: 25,
        shape: "flat",
      }),
    ).toEqual({ x: 41, y: 13 });

    for (const curvaturePercent of [0, 5, 18, 30]) {
      for (const cell of [
        { x: 1, y: 1 },
        { x: 80, y: 1 },
        { x: 1, y: 25 },
        { x: 80, y: 25 },
      ]) {
        const source = {
          x: (cell.x - 0.5) / 80,
          y: (cell.y - 0.5) / 25,
        };
        const point = sourcePointToDisplay(source, "curved", curvaturePercent);
        expect(
          terminalCellFromDisplayPoint({
            columns: 80,
            curvaturePercent,
            point,
            rows: 25,
            shape: "curved",
          }),
        ).toEqual(cell);
      }
    }
  });

  it("rejects non-finite, outside, and inactive curved-glass points", () => {
    for (const point of [
      { x: Number.NaN, y: 0.5 },
      { x: 0.5, y: Number.POSITIVE_INFINITY },
      { x: -0.01, y: 0.5 },
      { x: 0.5, y: 1.01 },
    ]) {
      expect(displayPointToSource(point, "curved")).toBeUndefined();
    }
    expect(displayPointToSource({ x: 0, y: 0 }, "curved")).toBeUndefined();
    expect(
      terminalCellFromDisplayPoint({
        columns: 80,
        point: { x: 1, y: 0.5 },
        rows: 25,
        shape: "flat",
      }),
    ).toBeUndefined();
    expect(() =>
      terminalCellFromDisplayPoint({
        columns: 0,
        point: { x: 0.5, y: 0.5 },
        rows: 25,
        shape: "flat",
      }),
    ).toThrow(/columns must be a positive safe integer/u);
  });

  it("encodes deterministic radial displacement channels", () => {
    expect(curvatureDisplacementChannels({ x: 0.5, y: 0.5 })).toEqual({
      blue: 0.5,
      green: 0.5,
      red: 0.5,
    });
    expect(curvatureDisplacementChannels({ x: 0, y: 0 })).toEqual({
      blue: 0.5,
      green: 0,
      red: 0,
    });
    expect(curvatureDisplacementChannels({ x: 1, y: 1 })).toEqual({
      blue: 0.5,
      green: 1,
      red: 1,
    });
  });
});
