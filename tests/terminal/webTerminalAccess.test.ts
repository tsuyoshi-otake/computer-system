import { describe, expect, it } from "vitest";

import { WebTerminalAccessRegistry } from "../../src/application/terminal/webTerminalAccess.js";

describe("WebTerminalAccessRegistry", (): void => {
  it("keeps one writer while allowing independent computers to write", (): void => {
    const access = new WebTerminalAccessRegistry();
    access.attach("session_0001", "c-000001", "writer");
    access.attach("session_0002", "c-000001", "viewer");
    access.attach("session_0003", "c-000002", "writer");

    expect(access.canWrite("session_0001")).toBe(true);
    expect(access.canWrite("session_0002")).toBe(false);
    expect(access.canWrite("session_0003")).toBe(true);
  });

  it("atomically demotes the old writer during takeover", (): void => {
    const access = new WebTerminalAccessRegistry();
    access.attach("session_0001", "c-000001", "writer");
    access.attach("session_0002", "c-000001", "viewer");

    expect(access.takeControl("session_0002")).toMatchObject({
      outcome: "transferred",
      demotedSessionId: "session_0001",
      session: { mode: "writer" },
    });
    expect(access.get("session_0001")?.mode).toBe("viewer");
    expect(access.canWrite("session_0001")).toBe(false);
    expect(access.canWrite("session_0002")).toBe(true);
    expect(access.takeControl("session_0002").outcome).toBe("unchanged");
  });

  it("reports a terminal close only when the final session detaches", (): void => {
    const access = new WebTerminalAccessRegistry();
    access.attach("session_0001", "c-000001", "writer");
    access.attach("session_0002", "c-000001", "viewer");

    expect(access.detach("session_0001")).toMatchObject({
      outcome: "detached",
      wasLast: false,
    });
    expect(access.canWrite("session_0002")).toBe(false);
    expect(access.detach("session_0002")).toMatchObject({
      outcome: "detached",
      wasLast: true,
    });
    expect(access.detach("session_0002")).toEqual({ outcome: "missing" });
  });
});
