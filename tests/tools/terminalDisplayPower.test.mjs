import { describe, expect, it } from "vitest";

import { terminalDisplayPowerState } from "../../web/terminal-display-power.js";

describe("Web Terminal display power", () => {
  it("blanks an explicitly powered-off Display without clearing terminal data", () => {
    expect(terminalDisplayPowerState("off", "stopping")).toBe("off");
  });

  it("fails dark when lifecycle is off even with a mismatched active Display", () => {
    expect(terminalDisplayPowerState("text", "off")).toBe("off");
  });

  it("shows active and backward-compatible terminal frames", () => {
    expect(terminalDisplayPowerState("post", "booting")).toBe("on");
    expect(terminalDisplayPowerState("text", "waiting_event")).toBe("on");
    expect(terminalDisplayPowerState(undefined, "waiting_event")).toBe("on");
  });
});
