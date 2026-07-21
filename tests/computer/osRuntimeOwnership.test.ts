import { describe, expect, it } from "vitest";

import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { OsRuntimeState } from "../../src/application/os/osRuntimeState.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("production OS runtime ownership", (): void => {
  it("shares one process table between ComputerRuntime, ShellSession, and persistence", (): void => {
    const record = new ComputerRecord("c-000777", "standard");
    const runtime = new ComputerRuntime();

    expect(runtime.register(record).outcome).toBe("accepted");
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    for (let tick = 0; tick < 200; tick += 1) {
      if (
        record.lifecycle.state.kind !== "booting" &&
        record.display.state.kind !== "post"
      ) {
        break;
      }
      runtime.runTick();
    }
    expect(record.display.state.kind).not.toBe("post");

    const processes = runtime.executeDebugShellCommand(
      record.computerId,
      "ps -f",
    );
    expect(processes).toMatchObject({ outcome: "completed", exitCode: 0 });
    if (processes.outcome !== "completed")
      throw new Error("production shell did not return a process table");
    expect(processes.stdout).toContain("/sbin/cs-init");
    expect(processes.stdout).toContain("/sbin/cs-getty tty1");
    expect(processes.stdout).toContain("/bin/bash");

    const persisted = record.osRuntimeSnapshot;
    expect(persisted).toBeDefined();
    if (persisted === undefined)
      throw new Error("Computer did not persist its OS runtime state");
    const restored = OsRuntimeState.restore(record.computerId, persisted);
    expect(restored.services()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "cs-login" })]),
    );
    expect(restored.mountDefinitions()).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: "/proc" })]),
    );
    expect(restored.snapshot().lastLogins).toEqual(
      expect.arrayContaining([expect.objectContaining({ username: "cs" })]),
    );

    const dmesg = runtime.executeDebugShellCommand(record.computerId, "dmesg");
    expect(dmesg).toMatchObject({ outcome: "completed", exitCode: 0 });
    if (dmesg.outcome !== "completed")
      throw new Error("production shell did not return its boot journal");
    for (const entry of restored.journalEntries("boot")) {
      expect(dmesg.stdout).toContain(entry.message);
    }
  });
});
