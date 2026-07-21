import { describe, expect, it } from "vitest";

import {
  calculateFixedGridFontSize,
  calculateIntegerGridPresentation,
  calculateLineCursorCell,
  calculateRasterPresentation,
  calculateTextRasterPresentation,
} from "../../web/terminal-layout.js";

const fixedGrid = {
  columns: 80,
  lineHeightRatio: 1.32,
  maximumPixels: 48,
  monospaceRatio: 0.61,
  rows: 25,
};

describe("fixed Web Terminal layout", () => {
  it("presents the 80x25 IBM 9x16 text raster on a 4:3 glass area", () => {
    const raster = calculateTextRasterPresentation({
      columns: 80,
      rows: 25,
    });

    expect(raster.fittedRows).toBe(27);
    expect(raster.rasterMarginRows).toBe(1);
    expect(raster.displayAspectRatio).toBeCloseTo(4 / 3, 12);
    expect(raster.logicalAspectRatio).toBeCloseTo(720 / 432, 12);
    expect(raster.physicalCellRatio).toBeCloseTo(0.45, 12);
    expect(raster.horizontalScale).toBeCloseTo(0.8, 12);
  });

  it("keeps 640x480 VGA square while correcting 320x200 independently", () => {
    expect(
      calculateRasterPresentation({
        logicalHeight: 480,
        logicalWidth: 640,
      }).horizontalScale,
    ).toBeCloseTo(1, 12);
    expect(
      calculateRasterPresentation({
        logicalHeight: 200,
        logicalWidth: 320,
      }).horizontalScale,
    ).toBeCloseTo(5 / 6, 12);
  });

  it("fits the 80x25 grid to both desktop axes", () => {
    const result = calculateFixedGridFontSize({
      ...fixedGrid,
      availableHeight: 900,
      availableWidth: 1_600,
    });
    expect(result.kind).toBe("fitted");
    expect(result.pixels * 80 * 0.61).toBeLessThanOrEqual(1_600);
    expect(result.pixels * 25 * 1.32).toBeLessThanOrEqual(900);
  });

  it("shrinks below the former 9.5px floor on a narrow stage", () => {
    const result = calculateFixedGridFontSize({
      ...fixedGrid,
      availableHeight: 480,
      availableWidth: 300,
    });
    expect(result).toMatchObject({ kind: "fitted" });
    expect(result.pixels).toBeLessThanOrEqual(300 / (80 * 0.61));
    expect(result.pixels).toBeGreaterThan(6);
    expect(result.pixels).toBeLessThan(9.5);
  });

  it("caps very large viewports without changing the grid", () => {
    expect(
      calculateFixedGridFontSize({
        ...fixedGrid,
        availableHeight: 4_000,
        availableWidth: 8_000,
      }),
    ).toEqual({ kind: "fitted", pixels: 48 });
  });

  it("returns an explicit transient result for a hidden stage", () => {
    expect(
      calculateFixedGridFontSize({
        ...fixedGrid,
        availableHeight: 0,
        availableWidth: 300,
      }),
    ).toEqual({ kind: "unmeasurable" });
  });

  it("uses whole-pixel cells and reports deterministic letterboxing", () => {
    const result = calculateIntegerGridPresentation({
      ...fixedGrid,
      availableHeight: 481,
      availableWidth: 641,
    });

    expect(result).toEqual({
      frameHeight: 429,
      frameWidth: 634,
      kind: "fitted",
      letterboxX: 3,
      letterboxY: 26,
      pixels: 13,
    });
    expect(Number.isInteger(result.pixels)).toBe(true);
  });

  it("never drops a visible grid below a one-pixel cell", () => {
    expect(
      calculateIntegerGridPresentation({
        ...fixedGrid,
        availableHeight: 1,
        availableWidth: 1,
      }),
    ).toMatchObject({
      frameHeight: 33,
      frameWidth: 49,
      kind: "fitted",
      letterboxX: 0,
      letterboxY: 0,
      pixels: 1,
    });
  });

  it("moves the local line cursor across rows without changing grid geometry", () => {
    expect(
      calculateLineCursorCell({
        baseX: 78,
        baseY: 2,
        columns: 80,
        rows: 25,
        selectionStart: 5,
        value: "hello",
      }),
    ).toEqual({ x: 3, y: 3 });
    expect(
      calculateLineCursorCell({
        baseX: 79,
        baseY: 24,
        columns: 80,
        rows: 25,
        selectionStart: 128,
        value: "x".repeat(128),
      }),
    ).toEqual({ x: 79, y: 24 });
  });

  it("counts Unicode code points rather than UTF-16 code units", () => {
    expect(
      calculateLineCursorCell({
        baseX: 0,
        baseY: 0,
        columns: 80,
        rows: 25,
        selectionStart: 2,
        value: "😀x",
      }),
    ).toEqual({ x: 1, y: 0 });
  });
});
