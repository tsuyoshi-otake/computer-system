import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("CS-Linux git command", (): void => {
  it("is installed only on CS-Linux and runs the local repository workflow", (): void => {
    const linuxFilesystem = new InMemoryFilesystem();
    const linux = new ShellSession(linuxFilesystem, {
      computerName: "cs-dev",
      osProfile: "linux",
    });

    expect(linux.submit("which git").stdout).toBe("/usr/bin/git\n");
    expect(linux.submit("mkdir project").exitCode).toBe(0);
    expect(linux.submit("cd project").exitCode).toBe(0);
    expect(linux.submit("git init")).toMatchObject({ exitCode: 0, stderr: "" });
    expect(linux.submit("printf 'hello\\n' > hello.txt").exitCode).toBe(0);
    expect(linux.submit("git add hello.txt")).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(linux.submit("git commit -m 'first commit'").stdout).toContain(
      "first commit",
    );
    expect(linux.submit("git status --short").stdout).toBe("");
    expect(linux.submit("git log --oneline").stdout).toContain("first commit");

    const dos = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });
    expect(dos.submit("git status").exitCode).not.toBe(0);
  });

  it("releases its transient RAM lease on success and failure", (): void => {
    const filesystem = new InMemoryFilesystem();
    const session = new ShellSession(filesystem, { osProfile: "linux" });
    const manager = session.linuxMemoryManager()!;
    const before = manager.snapshot();

    expect(session.submit("git init").exitCode).toBe(0);
    const afterSuccess = manager.snapshot();
    expect(afterSuccess.physical.usedBytes).toBe(before.physical.usedBytes);
    expect(
      afterSuccess.allocations.some(({ moduleId }) => moduleId === "git"),
    ).toBe(false);

    expect(session.submit("git add missing").exitCode).toBe(1);
    const afterFailure = manager.snapshot();
    expect(afterFailure.physical.usedBytes).toBe(before.physical.usedBytes);
    expect(
      afterFailure.allocations.some(({ moduleId }) => moduleId === "git"),
    ).toBe(false);
  });

  it("accounts repository reads and writes through the guest block-I/O boundary", (): void => {
    const requests: Array<{
      readonly bytes: number;
      readonly operation: string;
    }> = [];
    let sequence = 0;
    const session = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "linux",
      requestFilesystemIo: (operation, bytes): string => {
        requests.push({ bytes, operation });
        sequence += 1;
        return `git-io-${String(sequence)}`;
      },
    });

    expect(session.submit("git init")).toMatchObject({
      ioWaitEvent: "git-io-1",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.bytes).toBeGreaterThan(0);
    expect(requests[0]!.operation).toBe("write");
  });

  it("honors credentialed DAC for repository metadata", (): void => {
    const filesystem = new InMemoryFilesystem();
    const session = new ShellSession(filesystem, { osProfile: "linux" });
    expect(
      session.submit("mkdir private && cd private && git init").exitCode,
    ).toBe(0);
    filesystem.setMetadata("/home/cs/private/.git/index", { mode: 0o000 });

    const denied = session.submit("git status");
    expect(denied.exitCode).toBe(1);
    expect(denied.stderr).toContain("Permission denied");
  });
});
