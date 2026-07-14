import { describe, expect, it } from "vitest";

import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("ComputerRuntime", (): void => {
  it("boots startup.py and stops explicitly when the program completes", (): void => {
    const record = computer(
      "computer-1",
      'import term\nterm.write("booted")\n',
    );
    const runtime = runtimeWith(record);
    expect(runtime.powerOn(record.computerId)).toMatchObject({
      outcome: "accepted",
      state: "running",
    });
    runTicks(runtime, 2);
    expect(record.lifecycle.state).toEqual({ kind: "off" });
    expect(record.terminal.line(1)).toMatch(/^booted/u);
  });

  it("runs a bounded MicroPython file through the MCP debug path", (): void => {
    const record = computer("c-000001", "import os\nos.pull_event()\n");
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    record.filesystem.writeFile("/tmp/demo.py", "print(6 * 7)\n");

    const result = runtime.executeDebugShellCommand(
      record.computerId,
      "python /tmp/demo.py",
    );
    expect(result).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      stdout: "42\n",
    });
    expect(result.outcome === "completed" && result.stderr).toMatch(
      /^MicroPython: \d+ VM cycles/u,
    );
  });

  it("yields infinite work and synchronizes sleep and event waits", (): void => {
    const record = computer(
      "computer-2",
      'import os\nos.sleep(0.1)\nevent = os.pull_event("key")\nwhile True:\n    pass\n',
    );
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    runtime.runTick();
    expect(record.lifecycle.state.kind).toBe("sleeping");
    runtime.runTick();
    runtime.runTick();
    expect(record.lifecycle.state).toEqual({
      kind: "waiting_event",
      filter: "key",
    });
    expect(runtime.queueEvent(record.computerId, "mouse", 1).outcome).toBe(
      "accepted",
    );
    expect(runtime.queueEvent(record.computerId, "key", 42).outcome).toBe(
      "accepted",
    );
    runtime.runTick();
    expect(record.lifecycle.state.kind).toBe("running");
    expect(runtime.vmState(record.computerId)?.kind).toBe("ready");
  });

  it("finalizes shutdown, terminate, and reboot exactly once", (): void => {
    const shutdown = computer("computer-3", "import os\nos.shutdown()\n");
    const shutdownRuntime = runtimeWith(shutdown);
    shutdownRuntime.powerOn(shutdown.computerId);
    shutdownRuntime.runTick();
    expect(shutdown.lifecycle.state).toEqual({ kind: "off" });
    expect(shutdownRuntime.shutdown(shutdown.computerId)).toMatchObject({
      outcome: "ignored",
    });

    const terminated = computer("computer-4", "while True:\n    pass\n");
    const terminateRuntime = runtimeWith(terminated);
    terminateRuntime.powerOn(terminated.computerId);
    terminateRuntime.runTick();
    expect(terminateRuntime.terminate(terminated.computerId)).toMatchObject({
      outcome: "accepted",
      state: "stopping",
    });
    terminateRuntime.runTick();
    expect(terminated.lifecycle.state).toEqual({ kind: "off" });

    const rebooted = computer(
      "computer-5",
      'import os\nprint("boot")\nos.pull_event("reboot")\nos.reboot()\n',
    );
    const rebootRuntime = runtimeWith(rebooted);
    rebootRuntime.powerOn(rebooted.computerId);
    rebootRuntime.runTick();
    rebootRuntime.queueEvent(rebooted.computerId, "reboot");
    rebootRuntime.runTick();
    expect(rebooted.lifecycle.state.kind).toBe("running");
    expect(rebooted.terminal.line(1)).toMatch(/^boot/u);
    rebootRuntime.runTick();
    expect(rebooted.terminal.line(2)).toMatch(/^boot/u);
  });

  it("reports syntax and runtime crashes without leaving scheduled work", (): void => {
    const syntax = computer("computer-6", "if True\n    pass\n");
    const syntaxRuntime = runtimeWith(syntax);
    expect(syntaxRuntime.powerOn(syntax.computerId).outcome).toBe("failed");
    expect(syntax.lifecycle.state.kind).toBe("crashed");

    const fault = computer("computer-7", "missing_name\n");
    const faultRuntime = runtimeWith(fault);
    faultRuntime.powerOn(fault.computerId);
    faultRuntime.runTick();
    expect(fault.lifecycle.state.kind).toBe("crashed");
    if (fault.lifecycle.state.kind === "crashed") {
      expect(fault.lifecycle.state.message).toMatch(/not defined/u);
    }
    expect(faultRuntime.vmState(fault.computerId)).toBeUndefined();
  });
});

function computer(id: string, startup: string): ComputerRecord {
  const record = new ComputerRecord(id, "standard");
  record.filesystem.writeFile("/startup.py", startup);
  return record;
}

function runtimeWith(record: ComputerRecord): ComputerRuntime {
  const runtime = new ComputerRuntime({
    schedulerLimits: {
      eventCapacity: 8,
      timerCapacity: 8,
      instructionsPerComputer: 100,
      instructionsPerTick: 100,
    },
  });
  runtime.register(record);
  return runtime;
}

function runTicks(runtime: ComputerRuntime, count: number): void {
  for (let tick = 0; tick < count; tick += 1) runtime.runTick();
}
