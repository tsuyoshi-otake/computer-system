import { describe, expect, it, vi } from "vitest";

import {
  ComputerRuntime,
  type DebugShellCommandCompletion,
} from "../../src/application/computer/computerRuntime.js";
import type { OsRuntimeState } from "../../src/application/os/osRuntimeState.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { assembleCs486 } from "../../src/application/toolchain/cs486Assembler.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import { GuestRamLedger } from "../../src/domain/computer/guestRamLedger.js";
import { portableComputerHardware } from "../../src/domain/computer/hardware.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("guest resource accounting", (): void => {
  it("derives portable DOS MEM and process availability from the same ledger", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-000431", "standard", {
      displayProfileId: "portable-vga-256k",
      hardware: portableComputerHardware,
      osProfile: "dos",
    });
    runtime.register(record);
    let persistenceGeneration = 0;
    runtime.configureLifecycleBoundaries({
      pendingFilesystemIo: () => 0,
      stopDevices: () => undefined,
      syncPersistence: () => ({
        outcome: "saved",
        generation: ++persistenceGeneration,
      }),
    });
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    completeBoot(runtime, record);

    const memory = runtime.guestMemoryStatus(record.computerId)!;
    expect(memory).toMatchObject({
      availableBytes: 1_656_320,
      leaseCount: 9,
      totalBytes: 2 * 1_048_576,
      usedBytes: 440_832,
    });
    expect(memory.breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bytes: 262_144,
          category: "os",
          moduleId: "physical-unavailable",
        }),
        expect.objectContaining({
          bytes: 32_768,
          category: "os",
          displayName: "COMMAND.COM",
          moduleId: "command",
        }),
        expect.objectContaining({
          bytes: 65_536,
          category: "process",
          displayName: "System boot process",
          moduleId: "system",
        }),
      ]),
    );
    expect(memory.breakdown.reduce((sum, entry) => sum + entry.bytes, 0)).toBe(
      memory.usedBytes,
    );

    const mem = runtime.executeDebugShellCommand(record.computerId, "MEM");
    expect(mem).toMatchObject({ exitCode: 0, outcome: "completed" });
    if (mem.outcome === "completed") {
      expect(mem.stdout).toMatch(/Conventional\s+640K\s+68K\s+571K/u);
      expect(mem.stdout).toContain(
        "585472 bytes largest executable program size",
      );
      expect(mem.stdout).toContain("113152 bytes DOS system and drivers");
      expect(mem.stdout).toContain("65536 bytes guest runtime");
    }

    const executable = {
      ...assembleCs486("halt"),
      dataBytes: 2 * 1_048_576 - 1,
    };
    record.filesystem.writeFile(
      "/drives/c/too-big.csx",
      `CS486\n${JSON.stringify(executable)}`,
    );
    const rejected = runtime.executeDebugShellCommand(
      record.computerId,
      "C:\\TOO-BIG.CSX",
    );
    expect(rejected.outcome).toBe("failed");
    if (rejected.outcome === "failed") {
      expect(rejected.error.message).toMatch(/memory|data segment|RAM/iu);
    }
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(memory);

    expect(
      runtime.shutdown(record.computerId, "accounting test"),
    ).toMatchObject({
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
  });

  it("returns editor leases on close, disconnect, and failed admission", (): void => {
    const ledger = new GuestRamLedger(2 * 1_048_576);
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, {
      guestRamLedger: ledger,
      hardware: portableComputerHardware,
      osProfile: "dos",
    });
    const baselineBytes = ledger.usedBytes;

    expect(shell.submit("QBASIC").terminalScreen).toBeDefined();
    expect(ledger.snapshot().breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bytes: 256 * 1_024,
          category: "ide",
          displayName: "CS QBASIC",
          leases: 1,
          moduleId: "qbasic",
          owner: "dos-qbasic",
        }),
      ]),
    );
    shell.keys(["Enter"]);
    expect(shell.keys(["Alt+f", "x"]).resetTerminal).toBe(true);
    expect(ledger.usedBytes).toBe(baselineBytes);

    expect(shell.submit("vi C:\\DEMO.TXT").terminalScreen).toBeDefined();
    expect(ledger.snapshot().breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bytes: 192 * 1_024,
          category: "editor",
          displayName: "vi",
          leases: 1,
          moduleId: "vi",
          owner: "vi",
        }),
      ]),
    );
    expect(shell.submit(":q").resetTerminal).toBe(true);
    expect(ledger.usedBytes).toBe(baselineBytes);

    expect(shell.submit("EDIT C:\\DEMO.TXT").terminalScreen).toBeDefined();
    shell.disconnect();
    expect(ledger.usedBytes).toBe(baselineBytes);
    shell.dosMemoryManager()?.close();
    expect(ledger.usedBytes).toBe(0);

    const constrained = new GuestRamLedger(128 * 1_024);
    const rejectedShell = new ShellSession(new InMemoryFilesystem(), {
      guestRamLedger: constrained,
      hardware: portableComputerHardware,
      osProfile: "dos",
    });
    const constrainedBaselineBytes = constrained.usedBytes;
    const rejected = rejectedShell.submit("QBASIC");
    expect(rejected.exitCode).toBe(2);
    expect(rejected.stderr).toContain("Out of Memory");
    expect(constrained.usedBytes).toBe(constrainedBaselineBytes);
    rejectedShell.disconnect();
    rejectedShell.dosMemoryManager()?.close();
    expect(constrained.usedBytes).toBe(0);
  });

  it("holds and releases compiler RAM around an asynchronous compile job", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-000432", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    const bootMemory = runtime.guestMemoryStatus(record.computerId);
    expect(bootMemory).toBeDefined();
    record.filesystem.writeFile(
      "/tmp/main.c",
      'int main() { printf("%d\\n", 42); return 0; }\n',
    );
    let completed = false;

    runtime.enqueueDebugShellCommand(
      record.computerId,
      "cc /tmp/main.c -o /tmp/main",
      () => {
        completed = true;
      },
    );
    expect(runtime.guestMemoryStatus(record.computerId)?.breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bytes: 128 * 1_024,
          category: "compiler",
          displayName: "CS C",
          leases: 1,
          moduleId: "csc",
          owner: "compiler-c",
        }),
      ]),
    );

    runtime.runTick();
    expect(completed).toBe(true);
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(bootMemory);

    let interrupted = false;
    runtime.enqueueDebugShellCommand(
      record.computerId,
      "cc /tmp/main.c -o /tmp/cancelled",
      (result) => {
        interrupted = result.outcome === "completed" && result.exitCode === 130;
      },
    );
    expect(runtime.guestMemoryStatus(record.computerId)?.breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bytes: 128 * 1_024,
          category: "compiler",
          displayName: "CS C",
          leases: 1,
          moduleId: "csc",
          owner: "compiler-c",
        }),
      ]),
    );
    expect(runtime.interrupt(record.computerId)).toMatchObject({
      outcome: "accepted",
      state: "compile_interrupted",
    });
    expect(interrupted).toBe(true);
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(bootMemory);
  });

  it("completes bounded multi-step make through the synchronous MCP path", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-000949", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    const baselineMemory = runtime.guestMemoryStatus(record.computerId);
    record.filesystem.makeDirectory("/tmp/make-sync");
    record.filesystem.writeFile(
      "/tmp/make-sync/Makefile",
      "all:\n\ttouch first\n\ttouch second",
    );

    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        "make -C /tmp/make-sync -B",
      ),
    ).toMatchObject({ outcome: "completed", exitCode: 0 });
    expect(record.filesystem.exists("/tmp/make-sync/first")).toBe(true);
    expect(record.filesystem.exists("/tmp/make-sync/second")).toBe(true);
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(
      baselineMemory,
    );
  });

  it("ticks one make recipe at a time and finalizes RAM and PID on interrupt", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-000948", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    const baselineMemory = runtime.guestMemoryStatus(record.computerId);
    const osState = liveOsState(runtime, record.computerId);
    const baselinePids = osState.processes().map(({ pid }) => pid);
    record.filesystem.writeFile(
      "/home/cs/Makefile",
      "all:\n\ttouch /tmp/first\n\ttouch /tmp/second\n\ttouch /tmp/third",
    );
    const completions: DebugShellCommandCompletion[] = [];

    runtime.enqueueDebugShellCommand(record.computerId, "make -B", (result) =>
      completions.push(result),
    );

    expect(runtime.guestMemoryStatus(record.computerId)?.breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bytes: 128 * 1_024,
          category: "compiler",
          displayName: "CS Make",
          leases: 1,
          moduleId: "make",
          owner: "make",
        }),
      ]),
    );
    const makeProcess = osState
      .processes()
      .find(({ pid }) => !baselinePids.includes(pid));
    expect(makeProcess).toMatchObject({ command: "make", state: "running" });

    runtime.runTick();
    expect(record.filesystem.exists("/tmp/first")).toBe(false);
    expect(record.filesystem.exists("/tmp/second")).toBe(false);
    expect(completions).toEqual([]);
    expect(runtime.guestMemoryStatus(record.computerId)?.breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bytes: 128 * 1_024,
          moduleId: "make",
          owner: "make",
        }),
      ]),
    );

    runtime.runTick();
    expect(record.filesystem.exists("/tmp/first")).toBe(true);
    expect(record.filesystem.exists("/tmp/second")).toBe(false);
    expect(completions).toEqual([]);

    expect(runtime.interrupt(record.computerId)).toMatchObject({
      outcome: "accepted",
      state: "compile_interrupted",
    });
    expect(completions).toEqual([
      expect.objectContaining({ outcome: "completed", exitCode: 130 }),
    ]);
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(
      baselineMemory,
    );
    expect(osState.process(makeProcess!.pid)).toBeUndefined();
    runtime.runTick();
    expect(completions).toHaveLength(1);
    expect(record.filesystem.exists("/tmp/second")).toBe(false);

    const disconnectCompletions: DebugShellCommandCompletion[] = [];
    runtime.enqueueDebugShellCommand(record.computerId, "make -B", (result) =>
      disconnectCompletions.push(result),
    );
    expect(
      runtime.queueEvent(record.computerId, "terminal_closed"),
    ).toMatchObject({ outcome: "accepted" });
    expect(disconnectCompletions).toEqual([
      expect.objectContaining({ outcome: "completed", exitCode: 130 }),
    ]);
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(
      baselineMemory,
    );
    expect(osState.processes().some(({ command }) => command === "make")).toBe(
      false,
    );
    runtime.runTick();
    expect(disconnectCompletions).toHaveLength(1);
  });

  it("finalizes compiler RAM, callback, and process exactly once on terminal disconnect", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-000433", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    record.filesystem.writeFile(
      "/tmp/disconnect.c",
      'int main() { printf("%d\\n", 42); return 0; }\n',
    );
    const baselineMemory = runtime.guestMemoryStatus(record.computerId);
    expect(baselineMemory).toBeDefined();
    const osState = liveOsState(runtime, record.computerId);
    const baselinePids = osState.processes().map(({ pid }) => pid);
    const completions: DebugShellCommandCompletion[] = [];

    runtime.enqueueDebugShellCommand(
      record.computerId,
      "cc /tmp/disconnect.c -o /tmp/disconnect",
      (result) => completions.push(result),
    );

    const compileProcess = osState
      .processes()
      .find(({ pid }) => !baselinePids.includes(pid));
    expect(compileProcess).toMatchObject({ command: "c", state: "running" });
    expect(runtime.guestMemoryStatus(record.computerId)).toMatchObject({
      leaseCount: (baselineMemory?.leaseCount ?? 0) + 1,
      usedBytes: (baselineMemory?.usedBytes ?? 0) + 128 * 1_024,
    });
    const reapProcess = vi.spyOn(osState, "reapProcess");

    expect(
      runtime.queueEvent(record.computerId, "terminal_closed"),
    ).toMatchObject({ outcome: "accepted" });

    expect(completions).toEqual([
      expect.objectContaining({ outcome: "completed", exitCode: 130 }),
    ]);
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(
      baselineMemory,
    );
    expect(osState.process(compileProcess!.pid)).toBeUndefined();
    expect(
      reapProcess.mock.calls.filter(([pid]) => pid === compileProcess!.pid),
    ).toHaveLength(1);

    runtime.runTick();
    expect(completions).toHaveLength(1);
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(
      baselineMemory,
    );
    expect(
      reapProcess.mock.calls.filter(([pid]) => pid === compileProcess!.pid),
    ).toHaveLength(1);
  });
});

function liveOsState(
  runtime: ComputerRuntime,
  computerId: string,
): OsRuntimeState {
  const entries = (
    runtime as unknown as {
      readonly entries: ReadonlyMap<
        string,
        { readonly osRuntimeState: OsRuntimeState }
      >;
    }
  ).entries;
  const state = entries.get(computerId)?.osRuntimeState;
  if (state === undefined) throw new Error("missing runtime OS state");
  return state;
}

function completeBoot(runtime: ComputerRuntime, record: ComputerRecord): void {
  for (let tick = 0; tick < 200; tick += 1) {
    if (
      record.lifecycle.state.kind !== "booting" &&
      record.display.state.kind !== "post"
    ) {
      return;
    }
    runtime.runTick();
  }
  throw new Error("runtime did not complete CSBIOS");
}
