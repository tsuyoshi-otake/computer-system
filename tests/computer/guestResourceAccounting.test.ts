import { describe, expect, it } from "vitest";

import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { assembleCs486 } from "../../src/application/toolchain/cs486Assembler.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import {
  GuestRamLedger,
  type GuestRamOwner,
  type GuestRamSnapshot,
  type MemoryLease,
} from "../../src/domain/computer/guestRamLedger.js";
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

    const memory = runtime.guestMemoryStatus(record.computerId)!;
    expect(memory).toMatchObject({
      availableBytes: 2 * 1_048_576 - 64 * 1_024,
      totalBytes: 2 * 1_048_576,
      usedBytes: 64 * 1_024,
    });
    expect(memory.breakdown).toEqual([
      { bytes: 64 * 1_024, leases: 1, owner: "dos-resident" },
    ]);
    expect(memory.breakdown.reduce((sum, entry) => sum + entry.bytes, 0)).toBe(
      memory.usedBytes,
    );

    const mem = runtime.executeDebugShellCommand(record.computerId, "MEM");
    expect(mem).toMatchObject({ exitCode: 0, outcome: "completed" });
    if (mem.outcome === "completed") {
      expect(mem.stdout).toMatch(/Conventional\s+640K\s+64K\s+576K/u);
      expect(mem.stdout).toContain(
        "589824 bytes largest executable program size",
      );
      expect(mem.stdout).toContain("65536 bytes DOS system and drivers");
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
    const resident = ledger.acquire(64 * 1_024, "dos-resident");
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, {
      acquireMemoryLease: (bytes: number, owner: GuestRamOwner): MemoryLease =>
        ledger.acquire(bytes, owner),
      guestRamSnapshot: (): GuestRamSnapshot => ledger.snapshot(),
      hardware: portableComputerHardware,
      osProfile: "dos",
    });

    expect(shell.submit("QBASIC").terminalScreen).toBeDefined();
    expect(ledger.snapshot().breakdown).toContainEqual({
      bytes: 256 * 1_024,
      leases: 1,
      owner: "dos-qbasic",
    });
    shell.keys(["Enter"]);
    expect(shell.keys(["Alt+f", "x"]).resetTerminal).toBe(true);
    expect(ledger.usedBytes).toBe(64 * 1_024);

    expect(shell.submit("vi C:\\DEMO.TXT").terminalScreen).toBeDefined();
    expect(ledger.snapshot().breakdown).toContainEqual({
      bytes: 192 * 1_024,
      leases: 1,
      owner: "vi",
    });
    expect(shell.submit(":q").resetTerminal).toBe(true);
    expect(ledger.usedBytes).toBe(64 * 1_024);

    expect(shell.submit("EDIT C:\\DEMO.TXT").terminalScreen).toBeDefined();
    shell.disconnect();
    expect(ledger.usedBytes).toBe(64 * 1_024);
    resident.release();
    expect(ledger.usedBytes).toBe(0);

    const constrained = new GuestRamLedger(128 * 1_024);
    constrained.acquire(64 * 1_024, "dos-resident");
    const rejectedShell = new ShellSession(new InMemoryFilesystem(), {
      acquireMemoryLease: (bytes: number, owner: GuestRamOwner): MemoryLease =>
        constrained.acquire(bytes, owner),
      guestRamSnapshot: (): GuestRamSnapshot => constrained.snapshot(),
      hardware: portableComputerHardware,
      osProfile: "dos",
    });
    const rejected = rejectedShell.submit("QBASIC");
    expect(rejected.exitCode).toBe(2);
    expect(rejected.stderr).toContain("Out of Memory");
    expect(constrained.usedBytes).toBe(64 * 1_024);
  });

  it("holds and releases compiler RAM around an asynchronous compile job", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-000432", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
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
    expect(
      runtime.guestMemoryStatus(record.computerId)?.breakdown,
    ).toContainEqual({
      bytes: 128 * 1_024,
      leases: 1,
      owner: "compiler-c",
    });

    runtime.runTick();
    expect(completed).toBe(true);
    expect(runtime.guestMemoryStatus(record.computerId)).toMatchObject({
      leaseCount: 0,
      usedBytes: 0,
    });

    let interrupted = false;
    runtime.enqueueDebugShellCommand(
      record.computerId,
      "cc /tmp/main.c -o /tmp/cancelled",
      (result) => {
        interrupted = result.outcome === "completed" && result.exitCode === 130;
      },
    );
    expect(
      runtime.guestMemoryStatus(record.computerId)?.breakdown,
    ).toContainEqual({
      bytes: 128 * 1_024,
      leases: 1,
      owner: "compiler-c",
    });
    expect(runtime.interrupt(record.computerId)).toMatchObject({
      outcome: "accepted",
      state: "compile_interrupted",
    });
    expect(interrupted).toBe(true);
    expect(runtime.guestMemoryStatus(record.computerId)).toMatchObject({
      leaseCount: 0,
      usedBytes: 0,
    });
  });
});
