import { describe, expect, it } from "vitest";

import { shellTerminalStateOf } from "../../src/application/os/shellTerminalState.js";

describe("shell terminal state", (): void => {
  it("assigns every result one explicit terminal state", (): void => {
    expect(
      shellTerminalStateOf({ exitCode: 0, stderr: "", stdout: "" }),
    ).toEqual({ kind: "completed" });
    expect(
      shellTerminalStateOf({
        exitCode: 0,
        sleepTicks: 2,
        stderr: "",
        stdout: "",
      }),
    ).toEqual({ kind: "sleeping", ticks: 2 });
    expect(
      shellTerminalStateOf({
        action: "shutdown",
        exitCode: 0,
        stderr: "",
        stdout: "",
      }),
    ).toEqual({ action: "shutdown", kind: "lifecycle" });
  });

  it("rejects competing terminal owners", (): void => {
    expect(() =>
      shellTerminalStateOf({
        action: "shutdown",
        exitCode: 0,
        sleepTicks: 1,
        stderr: "",
        stdout: "",
      }),
    ).toThrow(/competing terminal states/u);
  });
});
