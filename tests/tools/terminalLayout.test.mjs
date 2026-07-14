import { describe, expect, it } from "vitest";

import { calculateFixedGridFontSize } from "../../web/terminal-layout.js";

const fixedGrid = {
  columns: 80,
  lineHeightRatio: 1.32,
  maximumPixels: 48,
  monospaceRatio: 0.61,
  rows: 25,
};

describe("fixed Web Terminal layout", () => {
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
});
