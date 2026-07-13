import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("DOS profile contract", (): void => {
  it("supports drive paths, case-insensitive lookup, CRLF boot files, and NUL", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, {
      computerName: "c-dos002",
      osProfile: "dos",
    });

    expect(shell.submit("CD C:\\DOS").exitCode).toBe(0);
    expect(shell.submit("PWD").lines).toEqual(["C:\\DOS"]);
    expect(
      shell.submit("ECHO VALUE > C:\\Users\\Computer\\Mixed.TXT").exitCode,
    ).toBe(0);
    expect(shell.submit("TYPE c:\\USERS\\COMPUTER\\mixed.txt").lines).toEqual([
      "VALUE",
    ]);
    expect(filesystem.readFile("/drives/c/autoexec.bat")).toContain("\r\n");
    expect(shell.submit("ECHO ignored > NUL").exitCode).toBe(0);
    expect(filesystem.exists("/drives/c/nul")).toBe(false);
  });

  it("persists the selected profile independently of Linux defaults", (): void => {
    const filesystem = new InMemoryFilesystem();
    new ShellSession(filesystem, { osProfile: "dos" });

    expect(filesystem.exists("/drives/c/config.sys")).toBe(true);
    expect(filesystem.exists("/etc/os-release")).toBe(false);
  });

  it("reports shared virtual hardware with DOS commands and no proc filesystem", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem(), {
      computerName: "c-dos002",
      hardware: { clockHz: 10_000, memoryBytes: 2_097_152 },
      memoryUsageBytes: (): number => 65_536,
      osProfile: "dos",
      ticksPerSecond: 20,
    });

    expect(shell.submit("CPU").lines).toContain("Clock speed: 33 MHz");
    expect(shell.submit("MEM").lines).toContain(
      "     2097152 bytes total memory",
    );
    expect(shell.submit("MEM /C").lines).toContain(
      "       65536 bytes VM runtime",
    );
    expect(shell.submit("MEM /P").exitCode).toBe(2);
    expect(shell.submit("SYSTEMINFO").lines).toContain("Computer ID: c-dos002");
    expect(shell.submit("CPUINFO").exitCode).toBe(127);
    expect(shell.submit("TYPE C:\\PROC\\CPUINFO").exitCode).toBe(1);
  });
});
