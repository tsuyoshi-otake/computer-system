import { describe, expect, it } from "vitest";

import {
  ManagedTerminalSession,
  type TerminalSessionEvent,
} from "../../src/application/terminal/session.js";

describe("managed terminal session", (): void => {
  it("emits exactly one event for every accepted line", (): void => {
    const emitted: TerminalSessionEvent[] = [];
    const session = new ManagedTerminalSession((event): void => {
      emitted.push(event);
    });
    expect(session.submitLine("first")).toBe(true);
    expect(session.submitLine("second")).toBe(true);
    expect(emitted).toEqual([
      { type: "terminal_line", line: "first" },
      { type: "terminal_line", line: "second" },
    ]);
  });

  it.each([
    ["normal close", false, "ClientClosed", "cancelled"],
    ["competing form", false, "UserBusy", "competing_form"],
    ["server close", false, "ServerClosed", "server_closed"],
    ["termination", true, "ServerClosed", "terminated"],
  ] as const)(
    "finalizes %s exactly once",
    (_name, terminate, reason, expected): void => {
      const emitted: TerminalSessionEvent[] = [];
      const session = new ManagedTerminalSession((event): void => {
        emitted.push(event);
      });
      if (terminate) expect(session.requestTermination()).toBe(true);
      expect(session.finalizeClose(reason).kind).toBe(expected);
      expect(session.finalizeClose("ClientClosed").kind).toBe(expected);
      expect(session.submitLine("late")).toBe(false);
      expect(
        emitted.filter((event) => event.type === "terminal_closed"),
      ).toHaveLength(1);
    },
  );

  it("distinguishes disconnect from visible failures", (): void => {
    const disconnected: TerminalSessionEvent[] = [];
    const disconnectedSession = new ManagedTerminalSession((event): void => {
      disconnected.push(event);
    });
    expect(
      disconnectedSession.finalizeFailure(new Error("lost"), false),
    ).toEqual({ kind: "disconnected" });

    const failed: TerminalSessionEvent[] = [];
    const failedSession = new ManagedTerminalSession((event): void => {
      failed.push(event);
    });
    expect(failedSession.finalizeFailure(new Error("broken"), true)).toEqual({
      kind: "failed",
      detail: "broken",
    });
  });
});
