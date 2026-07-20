import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import {
  linuxFilesystemImage,
  registerOsFilesystemImages,
} from "../../src/application/os/osFilesystemImages.js";
import type {
  ShellCommandResult,
  ShellMakeStepResult,
} from "../../src/application/os/shellTypes.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import {
  GUEST_MAKE_TOOLCHAIN_ID,
  parseGuestMakeState,
  serializeGuestMakeState,
} from "../../src/application/toolchain/guestMake.js";

function finishMake(
  shell: ShellSession,
  admitted: ShellCommandResult,
): ShellMakeStepResult {
  const foreground = admitted.foreground;
  if (foreground?.kind !== "compile" || foreground.task.kind !== "make") {
    throw new Error(
      "expected a make foreground task: " + JSON.stringify(admitted),
    );
  }
  for (let steps = 0; steps < 300; steps += 1) {
    const result = foreground.task.step();
    if (result.kind === "wait") {
      throw new Error("synchronous shell test unexpectedly scheduled I/O");
    }
    if (result.kind === "complete") {
      shell.completeToolchainForegroundProcess(
        result.result.exitCode,
        result.result.transcript,
      );
      return result;
    }
  }
  throw new Error("make did not reach a terminal state");
}

describe("CS-Linux make", (): void => {
  it("installs from CS-Linux rootfs v8 onward", (): void => {
    registerOsFilesystemImages();
    const v7 = new InMemoryFilesystem();
    v7.restore({
      baseImageId: "cs-linux-1.0-rootfs-v7",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    expect(v7.exists("/usr/bin/make")).toBe(false);

    const linux = new ComputerRecord("c-000944", "standard");
    const shell = new ShellSession(linux.filesystem, {
      deferGuestExecution: true,
      osProfile: "linux",
    });
    expect(linux.filesystem.baseImageId).toBe(linuxFilesystemImage.id);
    expect(linux.filesystem.exists("/usr/bin/make")).toBe(true);
    expect(shell.submit("make --version")).toMatchObject({
      exitCode: 0,
      stdout: "CS Make 1.0\n",
    });

    const dos = new ComputerRecord("c-000945", "standard", {
      osProfile: "dos",
    });
    const dosShell = new ShellSession(dos.filesystem, { osProfile: "dos" });
    expect(dos.filesystem.exists("/drives/c/dos/make.exe")).toBe(false);
    expect(dosShell.submit("MAKE")).toMatchObject({ exitCode: 127 });
  });

  it("builds C source in dependency order and becomes a no-op when current", (): void => {
    const record = new ComputerRecord("c-000946", "standard");
    const shell = new ShellSession(record.filesystem, {
      deferGuestExecution: true,
      osProfile: "linux",
    });
    record.filesystem.makeDirectory("/work");
    record.filesystem.writeFile("/work/main.c", "int main() { return 0; }\n");
    record.filesystem.writeFile(
      "/work/Makefile",
      [
        "app: main.o",
        "\tld main.o -o app",
        "main.o: main.c",
        "\tcc -c main.c -o main.o",
      ].join("\n"),
    );

    const completed = finishMake(
      shell,
      shell.submitDebugCommand("make -C /work"),
    );
    expect(completed).toMatchObject({
      kind: "complete",
      result: { exitCode: 0 },
    });
    expect(record.filesystem.readFile("/work/main.o")).toMatch(/^CS486OBJ\n/u);
    expect(record.filesystem.readFile("/work/app")).toMatch(/^CS486\n/u);

    const noOp = finishMake(shell, shell.submitDebugCommand("make -C /work"));
    expect(noOp).toMatchObject({
      kind: "complete",
      result: {
        exitCode: 0,
        transcript: {
          entries: [
            {
              channel: "stdout",
              kind: "text",
              text: "make: 'app' is up to date.\n",
            },
          ],
        },
      },
    });
    expect(record.filesystem.exists("/work/.cs-make-state")).toBe(true);
    expect(record.filesystem.readFile("/work/.cs-make-state")).toContain(
      '"toolchain":"' + GUEST_MAKE_TOOLCHAIN_ID + '"',
    );
    record.filesystem.writeFile("/work/main.c", "int main() { return 1; }\n");
    record.filesystem.setModifiedTime("/work/main.c", 1);
    const fingerprintRebuild = finishMake(
      shell,
      shell.submitDebugCommand("make -C /work"),
    );
    expect(fingerprintRebuild).toMatchObject({
      kind: "complete",
      result: { exitCode: 0 },
    });

    record.filesystem.delete("/work/.cs-make-state");
    const missingStateRebuild = finishMake(
      shell,
      shell.submitDebugCommand("make -C /work"),
    );
    expect(missingStateRebuild).toMatchObject({
      kind: "complete",
      result: { exitCode: 0 },
    });
    expect(JSON.stringify(missingStateRebuild)).toContain(
      "cc -c main.c -o main.o",
    );

    record.filesystem.writeFile("/work/app", "tampered\n");
    record.filesystem.setModifiedTime("/work/app", 1);
    const tamperedOutputRebuild = finishMake(
      shell,
      shell.submitDebugCommand("make -C /work"),
    );
    expect(JSON.stringify(tamperedOutputRebuild)).toContain("ld main.o -o app");

    const evictedState = parseGuestMakeState(
      record.filesystem.readFile("/work/.cs-make-state"),
    );
    evictedState.delete("/work/app");
    record.filesystem.writeFile(
      "/work/.cs-make-state",
      serializeGuestMakeState(evictedState),
    );
    const evictedRecordRebuild = finishMake(
      shell,
      shell.submitDebugCommand("make -C /work"),
    );
    expect(JSON.stringify(evictedRecordRebuild)).toContain("ld main.o -o app");

    const foreignState = record.filesystem
      .readFile("/work/.cs-make-state")
      .replace(GUEST_MAKE_TOOLCHAIN_ID, GUEST_MAKE_TOOLCHAIN_ID + "-foreign");
    record.filesystem.writeFile("/work/.cs-make-state", foreignState);
    const foreignToolchainRebuild = finishMake(
      shell,
      shell.submitDebugCommand("make -C /work"),
    );
    expect(JSON.stringify(foreignToolchainRebuild)).toContain(
      "cc -c main.c -o main.o",
    );
  });

  it("supports dry runs and rejects non-admitted recipe control flow", (): void => {
    const record = new ComputerRecord("c-000947", "standard");
    const shell = new ShellSession(record.filesystem, {
      deferGuestExecution: true,
      osProfile: "linux",
    });
    record.filesystem.writeFile("/Makefile", "out:\n\ttouch out");
    const dryRun = finishMake(shell, shell.submitDebugCommand("make -C / -n"));
    expect(dryRun).toMatchObject({
      kind: "complete",
      result: { exitCode: 0 },
    });
    expect(record.filesystem.exists("/out")).toBe(false);

    record.filesystem.writeFile("/Makefile", "out:\n\tsh build.sh");
    const rejected = finishMake(
      shell,
      shell.submitDebugCommand("make -C / -B"),
    );
    expect(rejected).toMatchObject({
      kind: "complete",
      result: { exitCode: 126 },
    });

    record.filesystem.writeFile("/Makefile", "out:\n\techo one | cat");
    const pipeline = finishMake(
      shell,
      shell.submitDebugCommand("make -C / -B"),
    );
    expect(pipeline).toMatchObject({
      kind: "complete",
      result: { exitCode: 2 },
    });
  });

  it("rejects inputs changed during a target and does not advance state", (): void => {
    const record = new ComputerRecord("c-000948", "standard");
    const shell = new ShellSession(record.filesystem, {
      deferGuestExecution: true,
      osProfile: "linux",
    });
    record.filesystem.makeDirectory("/work");
    record.filesystem.writeFile("/work/source", "before\n");
    record.filesystem.writeFile(
      "/work/Makefile",
      "out: source\n\tcp source out\n",
    );
    const admitted = shell.submitDebugCommand("make -C /work");
    const foreground = admitted.foreground;
    if (foreground?.kind !== "compile" || foreground.task.kind !== "make") {
      throw new Error("expected make task");
    }
    expect(foreground.task.step()).toEqual({ kind: "continue" });
    expect(foreground.task.step()).toEqual({ kind: "continue" });
    record.filesystem.writeFile("/work/source", "after\n");
    const completed = foreground.task.step();
    expect(completed).toMatchObject({
      kind: "complete",
      result: { exitCode: 1 },
    });
    expect(record.filesystem.exists("/work/.cs-make-state")).toBe(false);
  });

  it("commits completed targets before a later target fails", (): void => {
    const record = new ComputerRecord("c-000949", "standard");
    const shell = new ShellSession(record.filesystem, {
      deferGuestExecution: true,
      osProfile: "linux",
    });
    record.filesystem.makeDirectory("/work");
    record.filesystem.writeFile("/work/source", "ok\n");
    record.filesystem.writeFile(
      "/work/Makefile",
      [
        "all: good bad",
        "\ttouch all",
        "good: source",
        "\tcp source good",
        "bad:",
        "\tsh unavailable",
      ].join("\n"),
    );
    const completed = finishMake(
      shell,
      shell.submitDebugCommand("make -C /work"),
    );
    expect(completed).toMatchObject({
      kind: "complete",
      result: { exitCode: 126 },
    });
    const state = parseGuestMakeState(
      record.filesystem.readFile("/work/.cs-make-state"),
    );
    expect(state.has("/work/good")).toBe(true);
    expect(state.has("/work/bad")).toBe(false);
    expect(state.has("/work/all")).toBe(false);
  });

  it("restores the last committed state when state I/O completion fails", (): void => {
    const record = new ComputerRecord("c-000950", "standard");
    let io = 0;
    const shell = new ShellSession(record.filesystem, {
      deferGuestExecution: true,
      osProfile: "linux",
      requestFilesystemIo: (): string => "make-io-" + String(++io),
    });
    record.filesystem.makeDirectory("/work");
    record.filesystem.writeFile("/work/source", "ok\n");
    record.filesystem.writeFile(
      "/work/Makefile",
      "out: source\n\tcp source out\n",
    );
    const admitted = shell.submit("make -C /work");
    const foreground = admitted.foreground;
    if (foreground?.kind !== "compile" || foreground.task.kind !== "make") {
      throw new Error("expected make task");
    }
    expect(foreground.task.step()).toMatchObject({
      ioWaitEvent: "make-io-1",
      kind: "wait",
    });
    expect(foreground.task.step({ outcome: "completed" })).toMatchObject({
      ioWaitEvent: "make-io-2",
      kind: "wait",
    });
    expect(foreground.task.step({ outcome: "completed" })).toMatchObject({
      ioWaitEvent: "make-io-3",
      kind: "wait",
    });
    expect(
      foreground.task.step({ code: "EIO", outcome: "failed" }),
    ).toMatchObject({ ioWaitEvent: "make-io-4", kind: "wait" });
    const completed = foreground.task.step({ outcome: "completed" });
    expect(completed).toMatchObject({
      kind: "complete",
      result: { exitCode: 1 },
    });
    expect(
      parseGuestMakeState(record.filesystem.readFile("/work/.cs-make-state"))
        .size,
    ).toBe(0);
  });

  it("does not advance state when recipe I/O completion fails", (): void => {
    const record = new ComputerRecord("c-000951", "standard");
    let io = 0;
    const shell = new ShellSession(record.filesystem, {
      deferGuestExecution: true,
      osProfile: "linux",
      requestFilesystemIo: (): string => "make-io-" + String(++io),
    });
    record.filesystem.makeDirectory("/work");
    record.filesystem.writeFile("/work/source", "ok\n");
    record.filesystem.writeFile(
      "/work/Makefile",
      "out: source\n\tcp source out\n",
    );
    const admitted = shell.submit("make -C /work");
    const foreground = admitted.foreground;
    if (foreground?.kind !== "compile" || foreground.task.kind !== "make") {
      throw new Error("expected make task");
    }
    expect(foreground.task.step()).toMatchObject({ kind: "wait" });
    expect(foreground.task.step({ outcome: "completed" })).toMatchObject({
      kind: "wait",
    });
    const completed = foreground.task.step({
      code: "disk_fault",
      outcome: "failed",
    });
    expect(completed).toMatchObject({
      kind: "complete",
      result: { exitCode: 1 },
    });
    expect(record.filesystem.exists("/work/.cs-make-state")).toBe(false);
  });

  it("performs Makefile and fingerprint reads only inside the admitted task with DAC", (): void => {
    const record = new ComputerRecord("c-000952", "standard");
    const shell = new ShellSession(record.filesystem, {
      deferGuestExecution: true,
      osProfile: "linux",
    });
    record.filesystem.makeDirectory("/work");
    record.filesystem.writeFile("/work/source", "ok\n");
    record.filesystem.writeFile(
      "/work/Makefile",
      "out: source\n\tcp source out\n",
    );
    const admitted = shell.submitDebugCommand("make -C /work");
    expect(admitted.foreground).toMatchObject({
      command: "make",
      kind: "compile",
      task: { kind: "make" },
    });
    record.filesystem.setMetadata("/work/Makefile", {
      gid: 2_000,
      mode: 0o000,
      uid: 2_000,
    });
    const deniedMakefile = finishMake(shell, admitted);
    expect(deniedMakefile).toMatchObject({
      kind: "complete",
      result: { exitCode: 1 },
    });
    expect(JSON.stringify(deniedMakefile).toLowerCase()).toContain(
      "permission denied",
    );

    record.filesystem.setMetadata("/work/Makefile", {
      gid: 1_000,
      mode: 0o644,
      uid: 1_000,
    });
    record.filesystem.setMetadata("/work/source", {
      gid: 2_000,
      mode: 0o000,
      uid: 2_000,
    });
    const deniedInput = finishMake(
      shell,
      shell.submitDebugCommand("make -C /work"),
    );
    expect(deniedInput).toMatchObject({
      kind: "complete",
      result: { exitCode: 1 },
    });
    expect(JSON.stringify(deniedInput).toLowerCase()).toContain(
      "permission denied",
    );

    record.filesystem.setMetadata("/work/source", {
      gid: 1_000,
      mode: 0o644,
      uid: 1_000,
    });
    expect(
      finishMake(shell, shell.submitDebugCommand("make -C /work")),
    ).toMatchObject({
      kind: "complete",
      result: { exitCode: 0 },
    });
    record.filesystem.setMetadata("/work/.cs-make-state", {
      gid: 2_000,
      mode: 0o000,
      uid: 2_000,
    });
    const deniedState = finishMake(
      shell,
      shell.submitDebugCommand("make -C /work"),
    );
    expect(deniedState).toMatchObject({
      kind: "complete",
      result: { exitCode: 1 },
    });
    expect(JSON.stringify(deniedState).toLowerCase()).toContain(
      "permission denied",
    );

    record.filesystem.setMetadata("/work/.cs-make-state", {
      gid: 1_000,
      mode: 0o644,
      uid: 1_000,
    });
    record.filesystem.setMetadata("/work/out", {
      gid: 2_000,
      mode: 0o000,
      uid: 2_000,
    });
    const deniedOutput = finishMake(
      shell,
      shell.submitDebugCommand("make -C /work"),
    );
    expect(deniedOutput).toMatchObject({
      kind: "complete",
      result: { exitCode: 1 },
    });
    expect(JSON.stringify(deniedOutput).toLowerCase()).toContain(
      "permission denied",
    );
  });
});
