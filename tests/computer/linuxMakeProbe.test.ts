import { describe, expect, it } from "vitest";

import { runLinuxMakeProbe } from "../../src/application/computer/linuxMakeProbe.js";

describe("CS-Linux make production probe", (): void => {
  it("builds, skips, rebuilds, fails closed, and finalizes", (): void => {
    expect(runLinuxMakeProbe()).toMatchObject({
      built: true,
      failureStopped: true,
      finalized: true,
      missingStateRecovered: true,
      noOp: true,
      rebuilt: true,
      stateV2: true,
    });
  });
});
