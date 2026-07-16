import { describe, expect, it } from "vitest";

import { TerminalTargetRegistry } from "../../src/application/terminal/targetRegistry.js";

describe("terminal target registry", (): void => {
  it("shares the latest selected computer with monitor fallback", (): void => {
    const targets = new TerminalTargetRegistry();
    expect(targets.resolve("player-1")).toEqual({
      outcome: "missing",
      ownerId: "player-1",
    });
    expect(targets.select("player-1", "computer-7")).toEqual({
      outcome: "selected",
      computerId: "computer-7",
    });
    expect(targets.resolve("player-1")).toEqual({
      outcome: "selected",
      computerId: "computer-7",
    });
    targets.select("player-1", "computer-8");
    expect(targets.resolve("player-1")).toMatchObject({
      computerId: "computer-8",
    });
  });

  it("owns disconnect finalization explicitly", (): void => {
    const targets = new TerminalTargetRegistry();
    expect(targets.disconnect("player-2")).toEqual({
      outcome: "missing",
      ownerId: "player-2",
    });
    targets.select("player-2", "computer-9");
    expect(targets.disconnect("player-2")).toEqual({
      outcome: "disconnected",
      computerId: "computer-9",
    });
    expect(targets.resolve("player-2")).toMatchObject({ outcome: "missing" });
  });

  it("rejects empty identifiers", (): void => {
    const targets = new TerminalTargetRegistry();
    expect(() => targets.select("", "computer-1")).toThrow(/owner ID/u);
    expect(() => targets.select("player", " ")).toThrow(/computer ID/u);
  });
});
