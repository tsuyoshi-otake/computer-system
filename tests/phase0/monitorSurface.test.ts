import { describe, expect, it } from "vitest";

import {
  BoundedMonitorUpdates,
  discoverMonitorSurface,
  mapMonitorTouch,
} from "../../src/phase0/monitorSurface.js";

const threeByTwo = [
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 2, y: 1 },
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 2, y: 0 },
];

describe("monitor surface", () => {
  it("discovers a rectangular 3x2 connected surface", () => {
    const result = discoverMonitorSurface(threeByTwo);
    expect(result.outcome).toBe("connected");
    if (result.outcome !== "connected") return;
    expect(result.surface).toMatchObject({ width: 3, height: 2 });
  });

  it("rejects disconnected, non-rectangular, and oversized structures", () => {
    expect(
      discoverMonitorSurface([
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ]).outcome,
    ).toBe("disconnected");
    expect(discoverMonitorSurface(threeByTwo.slice(0, 5)).outcome).toBe(
      "non-rectangular",
    );
    expect(
      discoverMonitorSurface([...threeByTwo, { x: 3, y: 0 }]).outcome,
    ).toBe("too-large");
  });

  it("maps the outer corners to a 51x18 cell surface", () => {
    const result = discoverMonitorSurface(threeByTwo);
    if (result.outcome !== "connected") throw new Error("surface unavailable");
    expect(mapMonitorTouch(result.surface, { x: 0, y: 1 }, 0, 0.999)).toEqual({
      outcome: "mapped",
      cell: { x: 1, y: 1 },
    });
    expect(mapMonitorTouch(result.surface, { x: 2, y: 0 }, 0.999, 0)).toEqual({
      outcome: "mapped",
      cell: { x: 51, y: 18 },
    });
  });

  it("rejects touches outside the surface or local face", () => {
    const result = discoverMonitorSurface(threeByTwo);
    if (result.outcome !== "connected") throw new Error("surface unavailable");
    expect(
      mapMonitorTouch(result.surface, { x: 4, y: 0 }, 0.5, 0.5).outcome,
    ).toBe("outside");
    expect(
      mapMonitorTouch(result.surface, { x: 0, y: 1 }, 1, 0.5).outcome,
    ).toBe("outside");
  });

  it("coalesces changes and enforces queue and flush budgets", () => {
    const updates = new BoundedMonitorUpdates(2);
    expect(updates.write({ x: 1, y: 1, character: "a" })).toBe("queued");
    expect(updates.write({ x: 1, y: 1, character: "b" })).toBe("coalesced");
    expect(updates.write({ x: 2, y: 1, character: "c" })).toBe("queued");
    expect(updates.write({ x: 3, y: 1, character: "d" })).toBe("full");
    expect(updates.flush(1)).toEqual({
      remaining: 1,
      updates: [{ x: 1, y: 1, character: "b" }],
    });
  });
});
