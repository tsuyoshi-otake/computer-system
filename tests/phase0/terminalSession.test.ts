import { describe, expect, it } from "vitest";

import { TerminalSession } from "../../src/phase0/terminalSession.js";

describe("terminal session", (): void => {
  it("converts submitted input into an event without closing the session", (): void => {
    const session = new TerminalSession();

    expect(session.submitLine("hello computer")).toEqual({
      type: "terminal_line",
      line: "hello computer",
    });
    expect(session.getFinalization()).toBeUndefined();
  });

  it.each([
    ["ClientClosed", "cancelled"],
    ["UserBusy", "competing_form"],
    ["ServerClosed", "server_closed"],
  ] as const)("maps %s to %s", (reason, expected): void => {
    const session = new TerminalSession();

    expect(session.finalizeClose(reason)).toEqual({ kind: expected });
  });

  it("attributes a requested server close to termination", (): void => {
    const session = new TerminalSession();

    expect(session.requestTermination()).toBe(true);
    expect(session.requestTermination()).toBe(false);
    expect(session.finalizeClose("ServerClosed")).toEqual({
      kind: "terminated",
    });
  });

  it("maps an invalid player failure to disconnect", (): void => {
    const session = new TerminalSession();

    expect(session.finalizeFailure(new Error("invalid entity"), false)).toEqual(
      {
        kind: "disconnected",
      },
    );
  });

  it("maps other failures to an observable failed result", (): void => {
    const session = new TerminalSession();

    expect(session.finalizeFailure(new Error("form rejected"), true)).toEqual({
      kind: "failed",
      detail: "form rejected",
    });
  });

  it("keeps the first terminal result and rejects later input", (): void => {
    const session = new TerminalSession();

    expect(session.finalizeClose("ClientClosed")).toEqual({
      kind: "cancelled",
    });
    expect(session.finalizeFailure(new Error("late"), false)).toEqual({
      kind: "cancelled",
    });
    expect(session.submitLine("late input")).toBeUndefined();
  });
});
