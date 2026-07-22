import { describe, expect, it } from "vitest";

import {
  acceptanceFixtureWorldName,
  BdsDebugSession,
  isAllowedBdsCommand,
  isAllowedWebRelayCommand,
  isDiagnosticLine,
  parseWorkMonitorLine,
  parseBdsPort,
  validateAcceptanceFixtureStart,
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
    expect(
      isAllowedBdsCommand(
        "scriptevent computer_system:debug-computer-list labc-1 0 64",
      ),
    ).toBe(true);
    expect(
      isAllowedBdsCommand(
        "scriptevent computer_system:debug-acceptance-fixture aabc-1",
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
    expect(
      isAllowedBdsCommand(
        "scriptevent computer_system:debug-computer-list labc-1 0 65",
      ),
    ).toBe(false);
    expect(
      isAllowedBdsCommand(
        "scriptevent computer_system:debug-acceptance-fixture aabc-1 stop",
      ),
    ).toBe(false);
  });

  it("requires a fresh dedicated tmp world for the acceptance fixture", () => {
    const valid = {
      acceptanceFixture: true,
      resetWorld: true,
      explicitWorkRoot: true,
      worldName: acceptanceFixtureWorldName,
      temporaryRoot: "C:/Users/tester/tmp",
      workRoot: "C:/Users/tester/tmp/computer-system-acceptance-1",
    };
    expect(() => validateAcceptanceFixtureStart(valid)).not.toThrow();
    expect(() =>
      validateAcceptanceFixtureStart({ ...valid, resetWorld: false }),
    ).toThrow(/resetWorld/u);
    expect(() =>
      validateAcceptanceFixtureStart({ ...valid, explicitWorkRoot: false }),
    ).toThrow(/explicit BDS_MCP_WORKDIR/u);
    expect(() =>
      validateAcceptanceFixtureStart({ ...valid, worldName: "Production" }),
    ).toThrow(/ComputerSystemAcceptance/u);
    expect(() =>
      validateAcceptanceFixtureStart({
        ...valid,
        workRoot: "C:/Users/tester/project",
      }),
    ).toThrow(/user tmp/u);
    expect(() =>
      validateAcceptanceFixtureStart({
        ...valid,
        acceptanceFixture: false,
        resetWorld: false,
        explicitWorkRoot: false,
        worldName: "Production",
        workRoot: "C:/Users/tester/project",
      }),
    ).not.toThrow();
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
        "scriptevent computer_system:web-input abcdefghijkl request1 7 line hello%20world",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-input abcdefghijkl request2 7 keys %5B%22i%22%5D",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-input abcdefghijkl request3 7 mouse %7B%22action%22%3A%22move%22%2C%22button%22%3A0%2C%22sequence%22%3A1%2C%22x%22%3A12%2C%22y%22%3A4%7D",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-input abcdefghijkl line hello%20world",
      ),
    ).toBe(false);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-input abcdefghijkl short line hello",
      ),
    ).toBe(false);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-input abcdefghijkl request4 7 interrupt ",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-take-control abcdefghijkl",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-input abcdefghijkl request5 7 abort-line ",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-power abcdefghijkl request1 power_on",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-power abcdefghijkl request2 safe_boot",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-power abcdefghijkl request3 shutdown",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-floppy-eject abcdefghijkl request4",
      ),
    ).toBe(true);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-power abcdefghijkl request5 reboot",
      ),
    ).toBe(false);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-floppy-eject abcdefghijkl short",
      ),
    ).toBe(false);
    expect(
      isAllowedWebRelayCommand(
        "scriptevent computer_system:web-complete abcdefghijkl request1 7 3 vhel",
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
        "scriptevent computer_system:web-input abcdefghijkl request4 line hi\nstop",
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
    expect(
      isDiagnosticLine(
        '[Scripting][warning]-CS_WORK_MONITOR {"completedTicks":1}',
      ),
    ).toBe(false);
    expect(
      isDiagnosticLine(
        '[Scripting][warning]-CS_DEBUG_COMMAND {"status":"ignored","error":"not_running"}',
      ),
    ).toBe(false);
    expect(
      isDiagnosticLine(
        "[Scripting][warning]-CS_DEBUG_COMMAND malformed error response",
      ),
    ).toBe(true);
  });

  it("parses only bounded WorkMonitor status records", () => {
    const line = `[Scripting][warning]-CS_WORK_MONITOR ${JSON.stringify({
      completedTicks: 20,
      tickHostMicroseconds: { p50: 500, p95: 2_000, p99: 4_000 },
      lanes: { guest_cpu: { admitted: 4 } },
    })}`;
    expect(parseWorkMonitorLine(line)).toMatchObject({
      completedTicks: 20,
      tickHostMicroseconds: { p95: 2_000 },
    });
    expect(parseWorkMonitorLine("CS_WORK_MONITOR not-json")).toBeUndefined();
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

  it("lists a bounded page of exact placed Computer identities", async () => {
    class ComputerListSession extends BdsDebugSession {
      async runCommand(command) {
        this.command = command;
        return { command, afterCursor: 48 };
      }

      async waitForLog(options) {
        const requestId = options.contains.match(/"requestId":"([^"]+)"/u)?.[1];
        return {
          line:
            "CS_DEBUG_COMPUTER_LIST " +
            JSON.stringify({
              requestId,
              status: "completed",
              cursor: 0,
              nextCursor: null,
              total: 1,
              computers: [
                {
                  computerId: "c-00696j",
                  family: "advanced",
                  form: "block",
                  physicalKey: "overworld:1,2,3",
                },
              ],
            }),
        };
      }
    }

    const session = new ComputerListSession({
      environment: { BDS_HOME: "C:/not-accessed-by-computer-list" },
    });
    await expect(
      session.listComputers({ cursor: 0, limit: 1, timeoutMs: 1_000 }),
    ).resolves.toMatchObject({
      status: "completed",
      total: 1,
      computers: [{ computerId: "c-00696j", connectionCode: "6034" }],
    });
    expect(session.command).toMatch(
      /^scriptevent computer_system:debug-computer-list l[^ ]+ 0 1$/u,
    );
    await expect(session.listComputers({ limit: 65 })).rejects.toThrow(
      /between 1 and 64/u,
    );
  });

  it("provisions only an active acceptance fixture and validates its identity", async () => {
    class AcceptanceSession extends BdsDebugSession {
      async runCommand(command) {
        this.command = command;
        return { command, afterCursor: 50 };
      }

      async waitForLog(options) {
        const requestId = options.contains.match(/"requestId":"([^"]+)"/u)?.[1];
        return {
          line: `CS_DEBUG_ACCEPTANCE_FIXTURE ${JSON.stringify({
            requestId,
            status: "completed",
            computerId: "c-00696j",
          })}`,
        };
      }
    }

    const session = new AcceptanceSession({
      environment: { BDS_HOME: "C:/not-accessed-by-acceptance" },
    });
    await expect(session.provisionAcceptanceFixture()).rejects.toThrow(
      /not active/u,
    );
    session.acceptanceFixture = true;
    await expect(
      session.provisionAcceptanceFixture({ timeoutMs: 1_000 }),
    ).resolves.toMatchObject({
      status: "completed",
      computerId: "c-00696j",
    });
    expect(session.command).toMatch(
      /^scriptevent computer_system:debug-acceptance-fixture a[^ ]+$/u,
    );
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
