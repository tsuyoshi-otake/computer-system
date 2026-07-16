import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("CS-Linux persistent shell history", (): void => {
  it("persists a bounded mode-0600 history and reloads it for the same user", (): void => {
    const filesystem = new InMemoryFilesystem();
    const first = new ShellSession(filesystem);

    expect(first.submit("echo first")).toMatchObject({ exitCode: 0 });
    expect(filesystem.readFile("/home/cs/.bash_history")).toBe("echo first\n");
    expect(filesystem.getMetadata("/home/cs/.bash_history")).toMatchObject({
      gid: 1000,
      mode: 0o600,
      uid: 1000,
    });

    const restarted = new ShellSession(filesystem);
    expect(restarted.submit("history").stdout).toContain("echo first");
    expect(filesystem.readFile("/home/cs/.bash_history")).toContain(
      "history\n",
    );
  });

  it("never records first-boot password input", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, {
      passwordSalt: (): string => "abcdefghijklmnop",
      requireLogin: true,
    });

    expect(shell.submit("SecretPass1")).toMatchObject({ exitCode: 0 });
    expect(shell.submit("SecretPass1")).toMatchObject({ exitCode: 0 });
    expect(shell.submit("echo ready")).toMatchObject({ exitCode: 0 });

    const history = filesystem.readFile("/home/cs/.bash_history");
    expect(history).toBe("echo ready\n");
    expect(history).not.toContain("SecretPass1");
  });
});
