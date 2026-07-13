import { describe, expect, it } from "vitest";

import {
  BdsDebugSession,
  isAllowedBdsCommand,
  isAllowedWebRelayCommand,
  isDiagnosticLine,
  parseBdsPort,
} from "../../tools/bds-debug-session.mjs";

describe("BDS debug session", () => {
  it("accepts only bounded Computer System debug commands", () => {
    expect(isAllowedBdsCommand("list")).toBe(true);
    expect(
      isAllowedBdsCommand("scriptevent computer_system:probe headless"),
    ).toBe(true);
    expect(
      isAllowedBdsCommand(
        "execute as @a at @s run scriptevent computer_system:probe ui",
      ),
    ).toBe(true);
    expect(
      isAllowedBdsCommand(
        "execute as @a at @s run scriptevent computer_system:probe ui-custom",
      ),
    ).toBe(true);
    expect(
      isAllowedBdsCommand(
        "execute as @a at @s run scriptevent computer_system:probe ui-nano",
      ),
    ).toBe(true);
    expect(
      isAllowedBdsCommand(
        "scriptevent computer_system:debug-command dabc-1 c-9dwhx6 vwhoami",
      ),
    ).toBe(true);

    expect(isAllowedBdsCommand("stop")).toBe(false);
    expect(isAllowedBdsCommand("op @a")).toBe(false);
    expect(isAllowedBdsCommand("say hello")).toBe(false);
    expect(isAllowedBdsCommand("scriptevent computer_system:probe ui")).toBe(
      false,
    );
    expect(
      isAllowedBdsCommand(
        "execute as @a at @s run scriptevent computer_system:probe headless",
      ),
    ).toBe(false);
    expect(isAllowedBdsCommand("list\nstop")).toBe(false);
    expect(
      isAllowedBdsCommand(
        "scriptevent computer_system:debug-command dabc-1 c-9dwhx6 vwhoami stop",
      ),
    ).toBe(false);
  });

  it("validates ports without silently accepting trailing text", () => {
    expect(parseBdsPort(undefined)).toBe(19_142);
    expect(parseBdsPort("20000")).toBe(20_000);
    expect(() => parseBdsPort("20000debug")).toThrow(/between 1 and 65534/u);
    expect(() => parseBdsPort("0")).toThrow(/between 1 and 65534/u);
    expect(() => parseBdsPort("65535")).toThrow(/between 1 and 65534/u);
  });

  it("accepts only the internal browser-terminal relay protocol", () => {
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-response r1-1 abcdefghijkl writer http://127.0.0.1:19144/p/abcdefghijkl",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-input abcdefghijkl line hello%20world",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-input abcdefghijkl keys %5B%22i%22%5D",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-interrupt abcdefghijkl",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-take-control abcdefghijkl",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-complete abcdefghijkl request1 3 vhel",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-resize abcdefghijkl 130 40",
      ),
    ).toBe(true);
    expect(isAllowedWebRelayCommand("op @a")).toBe(false);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-input abcdefghijkl line hi\nstop",
      ),
    ).toBe(false);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-resize abcdefghijkl 130 40 stop",
      ),
    ).toBe(false);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-complete abcdefghijkl request1 cursor vhel",
      ),
    ).toBe(false);
  });

  it("classifies Bedrock content diagnostics", () => {
    expect(isDiagnosticLine("[Scripting] Error: boom")).toBe(true);
    expect(isDiagnosticLine("[Json] warning: invalid control")).toBe(true);
    expect(isDiagnosticLine("Server started.")).toBe(false);
  });

  it("exposes an explicit idle terminal state before startup", () => {
    const session = new BdsDebugSession({
      environment: {
        BDS_HOME: "C:/does-not-need-to-exist-until-start",
        BDS_MCP_PORT: "19150",
      },
    });
    expect(session.getStatus()).toMatchObject({
      state: "idle",
      running: false,
      ready: false,
      port: 19_150,
      lastError: null,
    });
    expect(() => session.runCommand("list")).toThrow(/not running/u);
  });
});
