import { describe, expect, it } from "vitest";

import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

const kib = 1_024;

describe("Linux memory architecture v2", (): void => {
  it("boots with real resident leases and feeds free and proc from one snapshot", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-003701", "standard");
    runtime.register(record);

    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runThroughBoot(runtime, record);
    const snapshot = runtime.linuxMemoryStatus(record.computerId);
    expect(snapshot).toBeDefined();
    expect(snapshot?.resident).toEqual({
      buffersBytes: 64 * kib,
      guestRuntimeBytes: 64 * kib,
      kernelBytes: 512 * kib,
      servicesBytes: 192 * kib,
    });
    expect(snapshot?.physical).toEqual({
      availableBytes: 1_280 * kib,
      freeBytes: 1_216 * kib,
      reclaimableBytes: 64 * kib,
      totalBytes: 2_048 * kib,
      usedBytes: 832 * kib,
    });
    expect(snapshot?.processes).toEqual([
      { pid: 1, residentBytes: 64 * kib, virtualBytes: 64 * kib },
    ]);

    const meminfo = runtime.executeDebugShellCommand(
      record.computerId,
      "cat /proc/meminfo",
    );
    expect(meminfo).toMatchObject({ outcome: "completed", exitCode: 0 });
    if (meminfo.outcome === "completed") {
      expect(meminfo.stdout).toContain("MemUsed:  851968 B");
      expect(meminfo.stdout).toContain("MemFree:  1245184 B");
      expect(meminfo.stdout).toContain("MemAvailable: 1310720 B");
      expect(meminfo.stdout).toContain("GuestRuntime: 65536 B");
    }

    const status = runtime.executeDebugShellCommand(
      record.computerId,
      "cat /proc/1/status",
    );
    expect(status).toMatchObject({ outcome: "completed", exitCode: 0 });
    if (status.outcome === "completed") {
      expect(status.stdout).toContain("VmSize:\t65536 B");
      expect(status.stdout).toContain("VmRSS:\t65536 B");
    }

    const top = runtime.executeDebugShellCommand(record.computerId, "top");
    expect(top).toMatchObject({ outcome: "completed", exitCode: 0 });
    if (top.outcome === "completed") {
      expect(top.stdout).toContain("VIRT        RES");
      expect(top.stdout).toMatch(/\s+1\s+0\s+0\s+R\s+65536\s+65536\s+/u);
    }
  });

  it("binds compiler residency to its PID and restores the boot snapshot", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-003702", "standard");
    runtime.register(record);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runThroughBoot(runtime, record);
    record.filesystem.writeFile("/tmp/main.c", "int main() { return 0; }\n");
    const baseline = runtime.linuxMemoryStatus(record.computerId);
    let completed = false;

    runtime.enqueueDebugShellCommand(
      record.computerId,
      "cc /tmp/main.c -o /tmp/main",
      () => {
        completed = true;
      },
    );
    const compiling = runtime.linuxMemoryStatus(record.computerId);
    const compiler = compiling?.allocations.find(
      ({ moduleId }) => moduleId === "csc",
    );
    expect(compiler).toMatchObject({
      category: "compiler",
      residentBytes: 128 * kib,
      virtualBytes: 128 * kib,
    });
    expect(compiler?.pid).not.toBeNull();
    expect(compiling?.processes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pid: compiler?.pid,
          residentBytes: 128 * kib,
          virtualBytes: 128 * kib,
        }),
      ]),
    );

    runtime.runTick();
    expect(completed).toBe(true);
    expect(runtime.linuxMemoryStatus(record.computerId)).toEqual(baseline);
  });

  it("rejects concurrent residency above MemAvailable without partial mutation", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-003705", "standard");
    record.filesystem.writeFile(
      "/startup.py",
      'import os\nos.pull_event("continue")\n',
    );
    runtime.register(record);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runThroughBoot(runtime, record);
    const baseline = runtime.linuxMemoryStatus(record.computerId);

    const result = runtime.executeDebugShellCommand(
      record.computerId,
      "python -c print(42)",
    );

    expect(result).toMatchObject({ outcome: "failed" });
    if (result.outcome === "failed") {
      expect(result.error.message).toMatch(
        /Out of Memory: python requested \d+ bytes with \d+ bytes available after buffer reclaim/u,
      );
    }
    expect(runtime.linuxMemoryStatus(record.computerId)).toEqual(baseline);
  });

  it("rebuilds the same transient snapshot after a cold reboot", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-003703", "standard");
    runtime.register(record);
    let generation = 0;
    runtime.configureLifecycleBoundaries({
      pendingFilesystemIo: () => 0,
      stopDevices: () => undefined,
      syncPersistence: () => ({
        generation: ++generation,
        outcome: "saved",
      }),
    });
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runThroughBoot(runtime, record);
    const first = runtime.linuxMemoryStatus(record.computerId);

    expect(runtime.reboot(record.computerId).outcome).toBe("accepted");
    runThroughBoot(runtime, record);
    expect(record.lifecycle.state.kind).not.toBe("booting");
    expect(runtime.linuxMemoryStatus(record.computerId)).toEqual(first);
  });

  it("faults undersized hardware without retaining a partial resident lease", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-003704", "standard", {
      hardware: {
        clockHz: 10_000,
        cpuModel: "cs486dx",
        memoryBytes: 512 * kib,
      },
    });
    runtime.register(record);

    expect(runtime.powerOn(record.computerId).outcome).toBe("failed");
    expect(runtime.guestMemoryStatus(record.computerId)).toBeUndefined();
    expect(runtime.linuxMemoryStatus(record.computerId)).toBeUndefined();
  });
});

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
