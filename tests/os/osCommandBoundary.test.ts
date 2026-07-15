import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("OS command boundary", (): void => {
  it("keeps Linux command names out of DOS execution and completion", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });

    for (const command of [
      "ls",
      "cat",
      "cp",
      "rm",
      "pwd",
      "bash",
      "sh",
      "source",
      "history",
      "grep",
      "false",
      "env",
      "shutdown",
      "reboot",
      "clear",
    ]) {
      expect(shell.submit(command), command).toMatchObject({
        exitCode: 127,
        stderr: "Bad command or file name\r\n",
        stdout: "",
      });
    }

    expect(shell.complete("l", 1).candidates).not.toContain("ls");
    expect(shell.complete("ba", 2).candidates).not.toContain("bash");
    expect(shell.complete("gr", 2).candidates).not.toContain("grep");
    expect(shell.complete("di", 2).candidates).toContain("dir");
    expect(shell.complete("co", 2).candidates).toContain("copy");

    expect(shell.submit("CLS")).toMatchObject({
      action: "clear",
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    expect(shell.submit("EXIT")).toMatchObject({
      action: "shutdown",
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
  });

  it("keeps DOS-only names out of Linux while retaining shared extensions", (): void => {
    const linux = new ShellSession(new InMemoryFilesystem());

    for (const command of [
      "DIR",
      "COPY",
      "DEL",
      "MEM",
      "CPU",
      "VER",
      "EDIT",
      "DOSKEY",
      "CLS",
    ]) {
      expect(linux.submit(command), command).toMatchObject({ exitCode: 127 });
    }

    const dos = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });
    expect(dos.submit("HELP VI").exitCode).toBe(0);
    expect(dos.submit("HELP CC").exitCode).toBe(0);
    expect(linux.submit("command -v vi").exitCode).toBe(0);
    expect(linux.submit("command -v cc").exitCode).toBe(0);
  });
});
