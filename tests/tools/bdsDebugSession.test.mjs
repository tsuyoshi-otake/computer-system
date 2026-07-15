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
        "execute as @a at @s run scriptevent computer_system:probe computer",
      ),
    ).toBe(true);
    expect(
      isAllowedBdsCommand(
        "execute as @a at @s run scriptevent computer_system:probe portable",
      ),
    ).toBe(true);
    expect(
      isAllowedBdsCommand(
        "scriptevent computer_system:debug-command dabc-1 c-9dwhx6 vwhoami",
      ),
    ).toBe(true);
    expect(
      isAllowedBdsCommand(
        "scriptevent computer_system:debug-web-request wabc-1 c-9dwhx6",
      ),
    ).toBe(true);

    expect(isAllowedBdsCommand("stop")).toBe(false);
    expect(isAllowedBdsCommand("op @a")).toBe(false);
    expect(isAllowedBdsCommand("say hello")).toBe(false);
    expect(
      isAllowedBdsCommand(
        "execute as @a at @s run scriptevent computer_system:probe pocket",
      ),
    ).toBe(false);
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
    expect(
      isAllowedBdsCommand(
        "scriptevent computer_system:debug-web-request wabc-1 c-9dwhx6 stop",
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
        "scriptevent computer_system:web-response r1-1 abcdefghijkl writer http://127.0.0.1:19144/p/0042",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-response r1-1 abcdefghijkl writer debug http://127.0.0.1:19144/p/0042",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-response r1-1 abcdefghijkl writer unrestricted http://127.0.0.1:19144/p/0042",
      ),
    ).toBe(false);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-response r1-1 abcdefghijkl writer http://127.0.0.1:19144/p/042",
      ),
    ).toBe(false);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-response r1-1 abcdefghijkl writer http://127.0.0.1:19144/p/abcdefghijkl",
      ),
    ).toBe(false);
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

  it("preserves run --stats microarchitecture output in MCP responses", async () => {
    class StatsSession extends BdsDebugSession {
      async runCommand(command) {
        this.command = command;
        return { command, afterCursor: 41 };
      }

      async waitForLog(options) {
        const requestId = options.contains.match(/"requestId":"([^"]+)"/u)?.[1];
        return {
          line: `CS_DEBUG_COMMAND ${JSON.stringify({
            requestId,
            computerId: "c-00696j",
            status: "completed",
            exitCode: 0,
            stdout: "",
            stderr:
              "CS386SX: 3 instructions, 21 CPU cycles, 1.313 us at 16 MHz, halted\\r\\nmemory: L1 0 hit/0 miss, L2 0 hit/0 miss, 14 bus transfers, 2 unaligned, 0 pipeline flushes\\r\\n",
            cpuCycles: 40,
          })}`,
        };
      }
    }

    const session = new StatsSession({
      environment: { BDS_HOME: "C:/not-accessed-by-debug-command" },
    });
    const response = await session.executeComputerCommand({
      computerId: "c-00696j",
      command: "run --stats C:\\UNALIGN",
    });

    expect(session.command).toMatch(
      /^scriptevent computer_system:debug-command d[^ ]+ c-00696j vrun%20--stats%20C%3A%5CUNALIGN$/u,
    );
    expect(response).toMatchObject({
      status: "completed",
      exitCode: 0,
      cpuCycles: 40,
    });
    expect(response.stderr).toContain("14 bus transfers, 2 unaligned");
  });

  it("encodes bounded multiline python -c source without opening BDS command injection", async () => {
    class InlinePythonSession extends BdsDebugSession {
      async runCommand(command) {
        this.command = command;
        return { command, afterCursor: 44 };
      }

      async waitForLog(options) {
        const requestId = options.contains.match(/"requestId":"([^"]+)"/u)?.[1];
        return {
          line: `CS_DEBUG_COMMAND ${JSON.stringify({
            requestId,
            computerId: "c-00696j",
            status: "completed",
            exitCode: 0,
            stdout: "5050\n",
            stderr:
              "Python/CS486DX: 1532 machine instructions, 16423 CPU cycles, 497.667 us at 33 MHz, completed\n",
            cpuCycles: 16_423,
          })}`,
        };
      }
    }

    const session = new InlinePythonSession({
      environment: { BDS_HOME: "C:/not-accessed-by-inline-python" },
    });
    const source =
      "total = 0\nfor i in range(1, 101):\n    total = total + i\nprint(total)";
    const response = await session.executeComputerCommand({
      computerId: "c-00696j",
      command: `python -c ${source}`,
    });

    expect(session.command).not.toMatch(/[\r\n]/u);
    expect(session.command).toContain("%0A");
    expect(response).toMatchObject({
      status: "completed",
      exitCode: 0,
      stdout: "5050\n",
      cpuCycles: 16_423,
    });
    await expect(
      session.executeComputerCommand({
        computerId: "c-00696j",
        command: "echo first\necho second",
      }),
    ).rejects.toThrow("only python -c");
  });

  it("requests a bounded Web handoff for one exact Computer identity", async () => {
    class WebRequestSession extends BdsDebugSession {
      async runCommand(command) {
        this.command = command;
        return { command, afterCursor: 52 };
      }

      async waitForLog(options) {
        const requestId = options.contains.match(/"requestId":"([^"]+)"/u)?.[1];
        return {
          line: `CS_DEBUG_WEB_REQUEST ${JSON.stringify({
            requestId,
            computerId: "c-00696j",
            status: "requested",
          })}`,
        };
      }
    }

    const session = new WebRequestSession({
      environment: { BDS_HOME: "C:/not-accessed-by-web-request" },
    });
    await expect(
      session.requestWebHandoff({
        computerId: "c-00696j",
        timeoutMs: 1_000,
      }),
    ).resolves.toMatchObject({ status: "requested" });
    expect(session.command).toMatch(
      /^scriptevent computer_system:debug-web-request w[^ ]+ c-00696j$/u,
    );
  });
});
