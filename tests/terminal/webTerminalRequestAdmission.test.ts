import { describe, expect, it } from "vitest";

import {
  WebTerminalRequestAdmission,
  type WebTerminalRequestAdmissionResult,
} from "../../src/application/terminal/webTerminalRequestAdmission.js";

describe("WebTerminalRequestAdmission", (): void => {
  it("deduplicates one interaction while it is pending and during cooldown", (): void => {
    const admission = new WebTerminalRequestAdmission(4, 10);
    expect(admit(admission, "r1-1", 1)).toEqual({ outcome: "admitted" });
    expect(admit(admission, "r1-2", 2)).toEqual({ outcome: "duplicate" });
    expect(admission.finalize("r1-1", "accepted", 3)).toBe(true);
    expect(admit(admission, "r1-3", 12)).toEqual({ outcome: "duplicate" });
    expect(admit(admission, "r1-4", 13)).toEqual({ outcome: "admitted" });
  });

  it("allows an immediate retry after an explicitly failed request", (): void => {
    const admission = new WebTerminalRequestAdmission();
    expect(admit(admission, "r1-1", 1)).toEqual({ outcome: "admitted" });
    expect(admission.finalize("r1-1", "failed", 2)).toBe(true);
    expect(admit(admission, "r1-2", 2)).toEqual({ outcome: "admitted" });
    expect(admission.finalize("missing", "failed", 2)).toBe(false);
  });

  it("keeps debug, player, and Computer admission keys independent", (): void => {
    const admission = new WebTerminalRequestAdmission();
    expect(admit(admission, "r1-1", 1)).toEqual({ outcome: "admitted" });
    expect(
      admission.admit({
        computerId: "c-000001",
        currentTick: 1,
        playerId: "player-1",
        requestId: "r1-2",
        source: "debug",
      }),
    ).toEqual({ outcome: "admitted" });
    expect(
      admission.admit({
        computerId: "c-000001",
        currentTick: 1,
        playerId: "player-2",
        requestId: "r1-3",
        source: "interaction",
      }),
    ).toEqual({ outcome: "admitted" });
    expect(
      admission.admit({
        computerId: "c-000002",
        currentTick: 1,
        playerId: "player-1",
        requestId: "r1-4",
        source: "interaction",
      }),
    ).toEqual({ outcome: "admitted" });
  });

  it("bounds capacity and frees it after failure or cooldown expiry", (): void => {
    const admission = new WebTerminalRequestAdmission(2, 5);
    expect(admit(admission, "r1-1", 1)).toEqual({ outcome: "admitted" });
    expect(
      admission.admit({
        computerId: "c-000002",
        currentTick: 1,
        playerId: "player-1",
        requestId: "r1-2",
        source: "interaction",
      }),
    ).toEqual({ outcome: "admitted" });
    expect(
      admission.admit({
        computerId: "c-000003",
        currentTick: 1,
        playerId: "player-1",
        requestId: "r1-3",
        source: "interaction",
      }),
    ).toEqual({ outcome: "capacity" });
    expect(admission.finalize("r1-1", "failed", 2)).toBe(true);
    expect(
      admission.admit({
        computerId: "c-000003",
        currentTick: 2,
        playerId: "player-1",
        requestId: "r1-3",
        source: "interaction",
      }),
    ).toEqual({ outcome: "admitted" });
    expect(admission.finalize("r1-2", "accepted", 2)).toBe(true);
    expect(admission.prune(6)).toBe(0);
    expect(admission.prune(7)).toBe(1);
  });
});

function admit(
  admission: WebTerminalRequestAdmission,
  requestId: string,
  currentTick: number,
): WebTerminalRequestAdmissionResult {
  return admission.admit({
    computerId: "c-000001",
    currentTick,
    playerId: "player-1",
    requestId,
    source: "interaction",
  });
}
