import { describe, expect, it } from "vitest";

import { CredentialedFilesystem } from "../../src/application/os/credentialedFilesystem.js";
import { rootCredentials } from "../../src/application/os/linuxCredentials.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("CS-Linux vmstat", (): void => {
  it("prints one snapshot derived from the process table and memory snapshot", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    expect(filesystem.exists("/usr/bin/vmstat")).toBe(true);
    const result = shell.submit("vmstat");
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(
      "procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----",
    );
    expect(lines[1]).toBe(
      " r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st",
    );
    // Boot presence: cs-init and bash runnable, getty waiting. Memory matches
    // the authoritative snapshot (free 1280 KiB, buffers 64 KiB) in KiB units.
    expect(lines[2]).toBe(
      " 2  1      0   1280     64      0    0    0     0     0    0    0  0  0 100  0  0",
    );
    expect(lines[3]).toBe("");

    const free = shell.submit("free");
    expect(free.exitCode).toBe(0);
    const freeBytes = Number(
      /Mem:\s+\d+\s+\d+\s+(\d+)/u.exec(free.stdout)?.[1],
    );
    expect(Math.floor(freeBytes / 1_024)).toBe(1_280);
  });

  it("rejects unsupported interval and count operands explicitly", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());
    expect(shell.submit("vmstat 5")).toMatchObject({
      exitCode: 2,
      stderr: "Usage: vmstat\n",
    });
    expect(shell.submit("vmstat 5 3")).toMatchObject({ exitCode: 2 });
    expect(shell.submit("vmstat -a")).toMatchObject({ exitCode: 2 });
  });

  it("returns 127 after the installed executable is deleted", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    new CredentialedFilesystem(filesystem, rootCredentials).delete(
      "/usr/bin/vmstat",
    );
    expect(shell.submit("vmstat")).toMatchObject({ exitCode: 127 });
  });

  it("serves the vmstat manual page", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());
    const man = shell.submit("man vmstat");
    expect(man.exitCode).toBe(0);
    expect(man.stdout).toContain("VMSTAT(1)");
    expect(man.stdout).toContain("virtual-memory statistics snapshot");
  });
});
