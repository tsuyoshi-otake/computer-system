import { describe, expect, it } from "vitest";

import {
  ComputerRuntime,
  type DebugShellCommandCompletion,
} from "../../src/application/computer/computerRuntime.js";
import { getOsProfile } from "../../src/application/os/osProfile.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { WebTerminalAccessRegistry } from "../../src/application/terminal/webTerminalAccess.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import { portableComputerHardware } from "../../src/domain/computer/hardware.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("DOS memory architecture v2 integration", (): void => {
  it("reparses CONFIG.SYS idempotently across reboot and host snapshot restore", (): void => {
    const record = dosRecord("c-000461");
    getOsProfile("dos").boot(record.filesystem, {
      computerName: record.computerId,
    });
    const config = [
      "DEVICE=C:\\DOS\\HIMEM.SYS",
      "DEVICE=C:\\DOS\\EMM386.EXE NOEMS",
      "DOS=HIGH,UMB",
      "FILES=40",
      "BUFFERS=20",
      "",
    ].join("\r\n");
    record.filesystem.writeFile("/drives/c/config.sys", config);

    const runtime = runtimeWithPersistence();
    runtime.register(record);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runThroughBoot(runtime, record);
    const firstBoot = runtime.guestMemoryStatus(record.computerId);
    expect(firstBoot).toBeDefined();
    expect(
      runtime.executeDebugShellCommand(record.computerId, "SET CONFIG_FILES"),
    ).toMatchObject({
      outcome: "completed",
      stderr: "Environment variable CONFIG_FILES not defined\r\n",
    });
    powerDown(runtime, record);

    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runThroughBoot(runtime, record);
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(firstBoot);
    powerDown(runtime, record);

    const restored = ComputerRecord.restore(record.snapshot());
    const restoredRuntime = runtimeWithPersistence();
    restoredRuntime.register(restored);
    expect(restoredRuntime.powerOn(restored.computerId).outcome).toBe(
      "accepted",
    );
    runThroughBoot(restoredRuntime, restored);
    expect(restoredRuntime.guestMemoryStatus(restored.computerId)).toEqual(
      firstBoot,
    );
    expect(restored.filesystem.readFile("/drives/c/config.sys")).toBe(config);
    powerDown(restoredRuntime, restored);
  });

  it("commits no partial driver state when CONFIG.SYS is invalid", (): void => {
    const filesystem = new InMemoryFilesystem();
    getOsProfile("dos").boot(filesystem, { computerName: "c-000462" });
    filesystem.writeFile(
      "/drives/c/config.sys",
      [
        "DEVICE=C:\\DOS\\HIMEM.SYS",
        "DEVICE=C:\\DOS\\UNKNOWN.SYS",
        "DOS=HIGH,UMB",
        "",
      ].join("\r\n"),
    );

    const shell = new ShellSession(filesystem, {
      hardware: portableComputerHardware,
      osProfile: "dos",
    });
    const snapshot = shell.dosMemoryManager()?.snapshot();

    expect(snapshot).toMatchObject({ state: "degraded-low" });
    expect(snapshot?.modules.map(({ moduleId }) => moduleId)).toEqual([
      "dos-kernel",
      "command",
      "dos-system-data",
    ]);
    expect(snapshot?.modules.some(({ moduleId }) => moduleId === "himem")).toBe(
      false,
    );
    expect(shell.takeStartupLines()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("UNKNOWN.SYS is unsupported"),
        "CONFIG.SYS: Invalid CONFIG.SYS; booted the explicit 64 KiB low-memory DOS profile",
      ]),
    );
    expect(shell.submit("MEM /D").lines).toContain(
      "Memory manager state: degraded-low",
    );
    shell.disconnect();
  });

  it("holds an exclusive legacy grant and releases it exactly once on disconnect", (): void => {
    const runtime = runtimeWithPersistence();
    const record = dosRecord("c-000463");
    runtime.register(record);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runThroughBoot(runtime, record);
    const baseline = runtime.guestMemoryStatus(record.computerId);
    expect(baseline).toBeDefined();
    record.filesystem.writeFile(
      "/drives/c/legacy.csx",
      `CS486\n${JSON.stringify({
        format: "cs486-executable",
        instructions: [{ op: "jmp", target: 0 }],
        version: 2,
      })}`,
    );
    const completions: DebugShellCommandCompletion[] = [];

    runtime.enqueueDebugShellCommand(
      record.computerId,
      "C:\\LEGACY.CSX",
      (result) => completions.push(result),
    );

    expect(runtime.guestMemoryStatus(record.computerId)).toMatchObject({
      availableBytes: 0,
    });
    expect(
      runtime
        .guestMemoryStatus(record.computerId)
        ?.breakdown.find(
          ({ category, moduleId }) =>
            category === "process" && moduleId === "run",
        ),
    ).toMatchObject({ bytes: baseline?.availableBytes });

    expect(
      runtime.queueEvent(record.computerId, "terminal_closed"),
    ).toMatchObject({ outcome: "accepted" });
    expect(completions).toEqual([
      expect.objectContaining({ exitCode: 130, outcome: "completed" }),
    ]);
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(baseline);
    runtime.runTick();
    expect(completions).toHaveLength(1);
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(baseline);
    powerDown(runtime, record);
  });

  it("keeps guest grants unchanged across concurrent Web Terminal sessions", (): void => {
    const runtime = runtimeWithPersistence();
    const record = dosRecord("c-000464");
    runtime.register(record);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runThroughBoot(runtime, record);
    const baseline = runtime.guestMemoryStatus(record.computerId);
    expect(baseline).toBeDefined();
    const access = new WebTerminalAccessRegistry();

    access.attach("session_0001", record.computerId, "writer");
    access.attach("session_0002", record.computerId, "viewer");
    access.attach("session_0003", record.computerId, "viewer");
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(baseline);

    expect(access.takeControl("session_0002")).toMatchObject({
      demotedSessionId: "session_0001",
      outcome: "transferred",
    });
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(baseline);

    expect(access.detach("session_0001")).toMatchObject({ wasLast: false });
    expect(access.detach("session_0002")).toMatchObject({ wasLast: false });
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(baseline);
    expect(access.detach("session_0003")).toMatchObject({ wasLast: true });
    expect(
      runtime.queueEvent(record.computerId, "terminal_closed"),
    ).toMatchObject({ outcome: "accepted" });
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(baseline);
    powerDown(runtime, record);
  });
});

function dosRecord(computerId: string): ComputerRecord {
  return new ComputerRecord(computerId, "standard", {
    displayProfileId: "portable-vga-256k",
    hardware: portableComputerHardware,
    osProfile: "dos",
  });
}

function runtimeWithPersistence(): ComputerRuntime {
  const runtime = new ComputerRuntime();
  let generation = 0;
  runtime.configureLifecycleBoundaries({
    pendingFilesystemIo: () => 0,
    stopDevices: () => undefined,
    syncPersistence: () => ({
      generation: ++generation,
      outcome: "saved",
    }),
  });
  return runtime;
}

function runThroughBoot(
  runtime: ComputerRuntime,
  record: ComputerRecord,
): void {
  let observedBoot =
    record.lifecycle.state.kind === "booting" ||
    record.display.state.kind === "post";
  for (let tick = 0; tick < 1_000; tick += 1) {
    if (
      observedBoot &&
      record.lifecycle.state.kind !== "booting" &&
      record.display.state.kind !== "post"
    ) {
      return;
    }
    runtime.runTick();
    observedBoot ||=
      record.lifecycle.state.kind === "booting" ||
      record.display.state.kind === "post";
  }
  throw new Error("Computer did not complete its bounded CSBIOS boot cycle");
}

function powerDown(runtime: ComputerRuntime, record: ComputerRecord): void {
  expect(runtime.shutdown(record.computerId, "DOS memory test")).toMatchObject({
    outcome: "accepted",
  });
  for (
    let tick = 0;
    tick < 1_000 && record.lifecycle.state.kind !== "off";
    tick += 1
  ) {
    runtime.runTick();
  }
  expect(record.lifecycle.state.kind).toBe("off");
  expect(runtime.guestMemoryStatus(record.computerId)).toBeUndefined();
}
