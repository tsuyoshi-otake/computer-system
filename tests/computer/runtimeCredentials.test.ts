import { describe, expect, it, vi } from "vitest";

import {
  ComputerRuntime,
  type DebugShellCommandCompletion,
} from "../../src/application/computer/computerRuntime.js";
import { getOsProfile } from "../../src/application/os/osProfile.js";
import { migrateLinuxAccountDatabase } from "../../src/application/os/linuxAccounts.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("ComputerRuntime process credentials", (): void => {
  it("rejects synchronous and queued MCP Python before Linux login", (): void => {
    const record = new ComputerRecord("c-000201", "standard");
    record.filesystem.writeFile(
      "/startup.py",
      'import os\nos.pull_event("continue")\n',
    );
    const runtime = registeredRuntime(record, true);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");

    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        'python -c print("not allowed")',
      ),
    ).toMatchObject({
      outcome: "completed",
      exitCode: 2,
      stderr:
        "debug: CS-Linux login is required before MCP command execution\n",
    });
    let queued: DebugShellCommandCompletion | undefined;
    runtime.enqueueDebugShellCommand(
      record.computerId,
      "python /startup.py",
      (result) => {
        queued = result;
      },
    );
    expect(queued).toMatchObject({
      outcome: "completed",
      exitCode: 2,
      stderr:
        "debug: CS-Linux login is required before MCP command execution\n",
    });
  });

  it("runs startup.py with the cs service identity rather than root", (): void => {
    const record = new ComputerRecord("c-000202", "standard");
    getOsProfile("linux").boot(record.filesystem, {
      computerName: record.computerId,
    });
    record.filesystem.setMetadata("/root", {
      gid: 0,
      mode: 0o700,
      uid: 0,
    });
    record.filesystem.writeFile(
      "/startup.py",
      'import fs\nfs.write_file("/root/startup-was-root", "bad")\n',
    );
    const runtime = registeredRuntime(record, false);

    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runtime.runTick();

    expect(record.filesystem.exists("/root/startup-was-root")).toBe(false);
    expect(record.lifecycle.state.kind).toBe("crashed");
  });

  it("keeps the internal shell module out of user-authored startup.py", (): void => {
    const record = new ComputerRecord("c-000212", "standard");
    record.filesystem.makeDirectory("/drives/c/lib/python");
    record.filesystem.writeFile("/startup.py", "import shell\n");
    const runtime = registeredRuntime(record, false);

    const boot = runtime.powerOn(record.computerId);
    expect(boot.outcome).toBe("accepted");
    runtime.runTick();

    expect(record.lifecycle.state.kind).toBe("crashed");
    if (record.lifecycle.state.kind === "crashed")
      expect(record.lifecycle.state.message).toContain("shell");
    expect(record.display.state.kind).toBe("faulted");
    if (record.display.state.kind === "faulted")
      expect(record.display.state.message).toContain("shell");
  });

  it("resolves startup.py supplementary groups from the authoritative UID 1000 account", (): void => {
    const record = new ComputerRecord("c-000206", "standard");
    getOsProfile("linux").boot(record.filesystem, {
      computerName: record.computerId,
    });
    const accounts = migrateLinuxAccountDatabase(record.filesystem);
    accounts.createGroup({ gid: 2_000, members: ["cs"], name: "startup" });
    record.filesystem.makeDirectory("/srv/startup");
    record.filesystem.setMetadata("/srv/startup", {
      gid: 2_000,
      mode: 0o770,
      uid: 0,
    });
    record.filesystem.writeFile(
      "/startup.py",
      'import fs\nfs.write_file("/srv/startup/ready", "yes")\n',
    );
    const runtime = registeredRuntime(record, false);

    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runTicks(runtime, 3);

    expect(record.filesystem.readFile("/srv/startup/ready")).toBe("yes");
    expect(record.filesystem.getMetadata("/srv/startup/ready")).toMatchObject({
      gid: 1_000,
      uid: 1_000,
    });
  });

  it("fails boot explicitly when the authoritative account database has no UID 1000", (): void => {
    const record = new ComputerRecord("c-000207", "standard");
    getOsProfile("linux").boot(record.filesystem, {
      computerName: record.computerId,
    });
    migrateLinuxAccountDatabase(record.filesystem).updateUser("cs", {
      uid: 1_001,
    });
    const runtime = registeredRuntime(record, false);

    const result = runtime.powerOn(record.computerId);

    expect(result).toMatchObject({ outcome: "failed" });
    if (result.outcome === "failed") {
      expect(result.error.message).toBe(
        "CS-Linux startup account UID 1000 is missing",
      );
    }
    expect(record.lifecycle.state.kind).toBe("crashed");
  });

  it("keeps direct MCP Python inside the authenticated user's DAC", (): void => {
    const record = new ComputerRecord("c-000204", "standard");
    record.filesystem.writeFile(
      "/startup.py",
      'import os\nos.pull_event("continue")\n',
    );
    const runtime = registeredRuntime(record, false);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    record.filesystem.setMetadata("/root", {
      gid: 0,
      mode: 0o700,
      uid: 0,
    });

    const result = runtime.executeDebugShellCommand(
      record.computerId,
      'python -c import fs\nfs.write_file("/root/mcp-was-root", "bad")',
    );

    expect(result).toMatchObject({ outcome: "completed", exitCode: 1 });
    if (result.outcome === "completed") {
      expect(result.stderr).toContain("FilesystemError");
      expect(result.stderr).toContain("Permission denied");
    }
    expect(record.filesystem.exists("/root/mcp-was-root")).toBe(false);
  });

  it("writes deferred compiler output with the captured cs identity and umask", (): void => {
    const record = new ComputerRecord("c-000203", "standard");
    record.filesystem.writeFile(
      "/startup.py",
      'import os\nos.pull_event("continue")\n',
    );
    const runtime = registeredRuntime(record, false);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    record.filesystem.writeFile("/tmp/answer.asm", "mov eax,42\nhalt\n");

    const result = runtime.executeDebugShellCommand(
      record.computerId,
      "as /tmp/answer.asm -o /tmp/answer",
    );
    expect(result).toMatchObject({ outcome: "completed", exitCode: 0 });
    expect(record.filesystem.getMetadata("/tmp/answer")).toMatchObject({
      gid: 1_000,
      mode: 0o644,
      uid: 1_000,
    });

    record.filesystem.writeFile(
      "/home/cs/relative.asm",
      "global _start\n_start:\nmov eax,42\nhalt\n",
    );
    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        "as -c relative.asm -o relative.o",
      ),
    ).toMatchObject({ outcome: "completed", exitCode: 0 });
    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        "ld relative.o -o relative",
      ),
    ).toMatchObject({ outcome: "completed", exitCode: 0 });
    expect(record.filesystem.exists("/home/cs/relative.o")).toBe(true);
    expect(record.filesystem.exists("/home/cs/relative")).toBe(true);
    expect(record.filesystem.exists("/relative.o")).toBe(false);
    expect(record.filesystem.exists("/relative")).toBe(false);
  });

  it("uses the admitted HOME for deferred assembler includes", (): void => {
    const record = new ComputerRecord("c-000208", "standard");
    record.filesystem.writeFile(
      "/startup.py",
      'import os\nos.pull_event("continue")\n',
    );
    const runtime = registeredRuntime(record, false);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    record.filesystem.makeDirectory("/home/custom");
    record.filesystem.setMetadata("/home/custom", {
      gid: 1_000,
      mode: 0o700,
      uid: 1_000,
    });
    record.filesystem.writeFile(
      "/home/custom/answer.inc",
      "%define ANSWER 42\n",
    );
    record.filesystem.writeFile(
      "/home/cs/home-include.asm",
      '%include "~/answer.inc"\nmov eax,ANSWER\nhalt\n',
    );
    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        "export HOME=/home/custom",
      ),
    ).toMatchObject({ outcome: "completed", exitCode: 0 });

    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        "as -c /home/cs/home-include.asm -o /home/cs/home-include.o",
      ),
    ).toMatchObject({ outcome: "completed", exitCode: 0 });
    expect(record.filesystem.exists("/home/cs/home-include.o")).toBe(true);
  });

  it("keeps synchronous and queued MCP Python on the live authenticated shell", (): void => {
    const record = new ComputerRecord("c-000209", "standard");
    const runtime = authenticatedRuntime(record);
    record.filesystem.writeFile("/tmp/live-marker", "still-here");
    record.filesystem.makeDirectory("/drives/c/lib/python");

    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        'python -c import fs\nprint(fs.read_file("/tmp/live-marker"))',
      ),
    ).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      stdout: "still-here\n",
    });
    const hiddenShell = runtime.executeDebugShellCommand(
      record.computerId,
      "python -c import shell",
    );
    expect(hiddenShell).toMatchObject({ outcome: "completed", exitCode: 1 });
    if (hiddenShell.outcome === "completed") {
      expect(hiddenShell.stderr).toContain("ImportError");
      expect(hiddenShell.stderr).toContain("shell");
    }

    const queued: DebugShellCommandCompletion[] = [];
    runtime.enqueueDebugShellCommand(
      record.computerId,
      'python -c import fs\nprint(fs.read_file("/tmp/live-marker"))',
      (result) => {
        queued.push(result);
      },
    );
    runTicks(runtime, 4);
    expect(queued[0]).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      stdout: "still-here\n",
    });
    runtime.enqueueDebugShellCommand(
      record.computerId,
      "python -c import shell",
      (result) => {
        queued.push(result);
      },
    );
    runTicks(runtime, 4);
    const hiddenQueuedShell = queued[1];
    expect(hiddenQueuedShell).toMatchObject({
      outcome: "completed",
      exitCode: 1,
    });
    if (hiddenQueuedShell?.outcome === "completed") {
      expect(hiddenQueuedShell.stderr).toContain("ImportError");
      expect(hiddenQueuedShell.stderr).toContain("shell");
    }
    expect(record.filesystem.readFile("/tmp/live-marker")).toBe("still-here");
    expect(
      runtime.executeDebugShellCommand(record.computerId, "whoami"),
    ).toMatchObject({ outcome: "completed", exitCode: 0, stdout: "cs\n" });
  });

  it("uses shell path and executable admission for MCP Python", (): void => {
    const record = new ComputerRecord("c-000211", "standard");
    const runtime = authenticatedRuntime(record);
    record.filesystem.writeFile("/home/cs/relative.py", "print(41)\n");

    expect(
      runtime.executeDebugShellCommand(record.computerId, "python relative.py"),
    ).toMatchObject({ outcome: "completed", exitCode: 0, stdout: "41\n" });
    let queued: DebugShellCommandCompletion | undefined;
    runtime.enqueueDebugShellCommand(
      record.computerId,
      "python relative.py",
      (result) => {
        queued = result;
      },
    );
    runTicks(runtime, 4);
    expect(queued).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      stdout: "41\n",
    });

    record.filesystem.setMetadata("/usr/bin/python", { mode: 0o644 });
    for (const command of ["python relative.py", "python -c print(42)"]) {
      const rejected = runtime.executeDebugShellCommand(
        record.computerId,
        command,
      );
      expect(rejected, command).toMatchObject({
        outcome: "completed",
        exitCode: 127,
      });
      if (rejected.outcome === "completed")
        expect(rejected.stderr, command).toContain("command not found");
    }
  });

  it("keeps the internal shell module out of interactive foreground Python", (): void => {
    const record = new ComputerRecord("c-000213", "standard");
    const runtime = registeredRuntime(record, false);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runtime.runTick();
    record.filesystem.makeDirectory("/drives/c/lib/python");
    record.filesystem.writeFile("/home/cs/no-shell.py", "import shell\n");

    runtime.queueEvent(
      record.computerId,
      "terminal_line",
      "python /home/cs/no-shell.py",
    );
    runTicks(runtime, 4);

    const terminal = record.terminal.snapshot().rows.join("\n");
    expect(terminal).toContain("ImportError");
    expect(terminal).toContain("shell");
    expect(record.lifecycle.state.kind).toBe("waiting_event");
  });

  it("cancels a captured root foreground process on the final terminal close", (): void => {
    const record = new ComputerRecord("c-000214", "standard");
    const runtime = authenticatedRuntime(record);
    record.filesystem.writeFile(
      "/tmp/disconnect-root.py",
      [
        "import os",
        "import fs",
        'os.pull_event("resume")',
        'fs.write_file("/root/disconnect-leak", "bad")',
        "",
      ].join("\n"),
    );

    runtime.queueEvent(record.computerId, "terminal_line", "sudo -i");
    runtime.runTick();
    expect(runtime.isShellSecretInput(record.computerId)).toBe(true);
    runtime.queueEvent(record.computerId, "terminal_line", "correct-horse");
    runtime.runTick();
    expect(runtime.isShellSecretInput(record.computerId)).toBe(false);
    runtime.queueEvent(
      record.computerId,
      "terminal_line",
      "python /tmp/disconnect-root.py",
    );
    runTicks(runtime, 2);
    expect(runtime.vmState(record.computerId)?.kind).toBe("waiting_event");

    expect(
      runtime.queueEvent(record.computerId, "terminal_closed").outcome,
    ).toBe("accepted");
    expect(runtime.isShellSecretInput(record.computerId)).toBe(false);
    expect(
      runtime.executeDebugShellCommand(record.computerId, "whoami"),
    ).toMatchObject({ exitCode: 2, outcome: "completed" });
    runtime.runTick();
    runtime.queueEvent(record.computerId, "resume");
    runtime.runTick();

    expect(record.filesystem.exists("/root/disconnect-leak")).toBe(false);
    expect(record.terminal.snapshot().rows.join("\n")).toContain("login:");
    runtime.queueEvent(record.computerId, "terminal_line", "cs");
    runtime.runTick();
    runtime.queueEvent(record.computerId, "terminal_line", "correct-horse");
    runtime.runTick();
    expect(
      runtime.executeDebugShellCommand(record.computerId, "whoami"),
    ).toMatchObject({ exitCode: 0, outcome: "completed", stdout: "cs\n" });
  });

  it("clears an unattended secret prompt on the final terminal close", (): void => {
    const record = new ComputerRecord("c-000215", "standard");
    const runtime = authenticatedRuntime(record);
    runtime.queueEvent(record.computerId, "terminal_line", "sudo whoami");
    runtime.runTick();
    expect(runtime.isShellSecretInput(record.computerId)).toBe(true);

    expect(
      runtime.queueEvent(record.computerId, "terminal_closed").outcome,
    ).toBe("accepted");
    expect(runtime.isShellSecretInput(record.computerId)).toBe(false);
    runtime.runTick();

    expect(record.terminal.snapshot().rows.join("\n")).toContain("login:");
    expect(
      runtime.executeDebugShellCommand(record.computerId, "whoami"),
    ).toMatchObject({ exitCode: 2, outcome: "completed" });
  });

  it("rolls back an admitted compiler job on the final terminal close", (): void => {
    const record = new ComputerRecord("c-000216", "standard");
    const runtime = authenticatedRuntime(record);
    record.filesystem.writeFile(
      "/home/cs/disconnect.asm",
      "global _start\n_start:\nmov eax,42\nhalt\n",
    );
    runtime.queueEvent(
      record.computerId,
      "terminal_line",
      "as /home/cs/disconnect.asm -o /home/cs/disconnect",
    );
    runtime.runTick();

    expect(
      runtime.queueEvent(record.computerId, "terminal_closed").outcome,
    ).toBe("accepted");
    runtime.runTick();

    expect(record.filesystem.exists("/home/cs/disconnect")).toBe(false);
    expect(record.terminal.snapshot().rows.join("\n")).toContain("login:");
    expect(
      runtime.executeDebugShellCommand(record.computerId, "whoami"),
    ).toMatchObject({ exitCode: 2, outcome: "completed" });
  });

  it("cancels captured root MCP work on the final terminal close", (): void => {
    const record = new ComputerRecord("c-000217", "standard");
    const runtime = authenticatedRuntime(record);
    runtime.queueEvent(record.computerId, "terminal_line", "sudo true");
    runtime.runTick();
    runtime.queueEvent(record.computerId, "terminal_line", "correct-horse");
    runtime.runTick();
    record.filesystem.writeFile(
      "/tmp/debug-disconnect.py",
      'import fs\nfs.write_file("/root/debug-disconnect-leak", "bad")\n',
    );
    let completion: DebugShellCommandCompletion | undefined;
    runtime.enqueueDebugShellCommand(
      record.computerId,
      "sudo -n python /tmp/debug-disconnect.py",
      (result) => {
        completion = result;
      },
    );
    expect(completion).toBeUndefined();

    expect(
      runtime.queueEvent(record.computerId, "terminal_closed").outcome,
    ).toBe("accepted");

    expect(completion).toMatchObject({
      exitCode: 130,
      outcome: "completed",
      stderr: "debug: terminal session disconnected\n",
    });
    runtime.runTick();
    expect(record.filesystem.exists("/root/debug-disconnect-leak")).toBe(false);
    expect(
      runtime.executeDebugShellCommand(record.computerId, "whoami"),
    ).toMatchObject({ exitCode: 2, outcome: "completed" });
  });

  it("does not leave a phantom debug job when scheduler admission fails", (): void => {
    const record = new ComputerRecord("c-000210", "standard");
    record.filesystem.writeFile(
      "/startup.py",
      'import os\nos.pull_event("continue")\n',
    );
    const runtime = registeredRuntime(record, false);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    const scheduler = (
      runtime as unknown as {
        readonly scheduler: {
          add(id: number, process: unknown, cpuCyclesPerTick?: number): void;
        };
      }
    ).scheduler;
    const add = vi.spyOn(scheduler, "add").mockImplementationOnce((): never => {
      throw new Error("injected scheduler admission failure");
    });
    let failed: DebugShellCommandCompletion | undefined;

    runtime.enqueueDebugShellCommand(
      record.computerId,
      "python -c print(42)",
      (result) => {
        failed = result;
      },
    );
    add.mockRestore();

    expect(failed).toMatchObject({ outcome: "failed" });
    if (failed?.outcome === "failed") {
      expect(failed.error.message).toBe("injected scheduler admission failure");
    }
    const retry: DebugShellCommandCompletion[] = [];
    runtime.enqueueDebugShellCommand(
      record.computerId,
      "python -c print(42)",
      (result) => {
        retry.push(result);
      },
    );
    runTicks(runtime, 4);
    expect(retry[0]).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      stdout: "42\n",
    });
  });

  it("finalizes a failed synchronous MCP compile instead of remaining busy", (): void => {
    const record = new ComputerRecord("c-000205", "standard");
    record.filesystem.writeFile(
      "/startup.py",
      'import os\nos.pull_event("continue")\n',
    );
    const runtime = registeredRuntime(record, false);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    record.filesystem.writeFile("/home/cs/bad.asm", "not-an-instruction\n");

    expect(
      runtime.executeDebugShellCommand(record.computerId, "as bad.asm -o bad"),
    ).toMatchObject({ outcome: "completed", exitCode: 1 });
    expect(
      runtime.executeDebugShellCommand(record.computerId, "whoami"),
    ).toMatchObject({ outcome: "completed", exitCode: 0, stdout: "cs\n" });
  });
});

function registeredRuntime(
  record: ComputerRecord,
  requireLinuxLogin: boolean,
): ComputerRuntime {
  const runtime = new ComputerRuntime({
    requireLinuxLogin,
    schedulerLimits: {
      cpuCyclesPerComputer: 100_000,
      cpuCyclesPerTick: 100_000,
      eventCapacity: 8,
      timerCapacity: 8,
    },
  });
  runtime.register(record);
  return runtime;
}

function authenticatedRuntime(record: ComputerRecord): ComputerRuntime {
  const setup = new ShellSession(record.filesystem, {
    osProfile: "linux",
    requireLogin: true,
  });
  setup.submit("correct-horse");
  setup.submit("correct-horse");
  const runtime = registeredRuntime(record, true);
  expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
  runtime.runTick();
  runtime.queueEvent(record.computerId, "terminal_line", "cs");
  runtime.runTick();
  runtime.queueEvent(record.computerId, "terminal_line", "correct-horse");
  runtime.runTick();
  return runtime;
}

function runTicks(runtime: ComputerRuntime, count: number): void {
  for (let tick = 0; tick < count; tick += 1) runtime.runTick();
}
