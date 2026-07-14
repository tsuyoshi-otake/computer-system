import { describe, expect, it } from "vitest";

import { sha256Hex } from "../../src/application/os/passwordHash.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("CS-Linux authentication", (): void => {
  it("implements the standard SHA-256 digest", (): void => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("sets a password twice on first boot without history or plaintext storage", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = linuxShell(filesystem);

    expect(shell.takeStartupLines()).toEqual([]);
    expect(shell.prompt()).toBe("New password: ");
    expect(shell.isSecretInput()).toBe(true);
    expect(shell.complete("ec", 2).candidates).toEqual([]);
    expect(shell.submit("short").stderr).toContain("at least 8 characters");

    expect(shell.submit("correct-horse").exitCode).toBe(0);
    expect(shell.prompt()).toBe("Retype new password: ");
    expect(filesystem.exists("/etc/shadow")).toBe(false);
    expect(shell.submit("different-password").stderr).toContain("do not match");
    expect(shell.prompt()).toBe("New password: ");

    shell.submit("correct-horse");
    expect(shell.submit("correct-horse").stdout).toBe("Password configured.\n");
    expect(shell.isSecretInput()).toBe(false);
    expect(shell.prompt()).toBe("~$ ");
    expect(shell.submit("whoami").stdout).toBe("computer\n");
    const shadow = filesystem.readFile("/etc/shadow");
    expect(shadow).toMatch(/^computer:cs-sha256-v1:512:/u);
    expect(shadow).not.toContain("correct-horse");
    expect(shell.submit("cat /etc/shadow").stderr).toContain(
      "Permission denied",
    );
  });

  it("requires the saved password and throttles each third failed attempt", (): void => {
    const filesystem = new InMemoryFilesystem();
    const initial = linuxShell(filesystem);
    initial.submit("correct-horse");
    initial.submit("correct-horse");

    const shell = linuxShell(filesystem);
    expect(shell.takeStartupLines()).toEqual([]);
    expect(shell.prompt()).toBe("Password: ");
    expect(shell.submitDebugCommand("whoami").stderr).toContain(
      "login is required",
    );
    expect(shell.submit("wrong-password").sleepTicks).toBeUndefined();
    expect(shell.submit("wrong-password").sleepTicks).toBeUndefined();
    expect(shell.submit("wrong-password").sleepTicks).toBe(40);
    expect(shell.prompt()).toBe("Password: ");
    expect(shell.submit("correct-horse").stdout).toBe("Login successful.\n");
    expect(shell.submit("whoami").stdout).toBe("computer\n");
  });

  it("does not apply the CS-Linux login gate to CS-DOS", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
      requireLogin: true,
    });
    expect(shell.isSecretInput()).toBe(false);
    expect(shell.prompt()).toBe("C:\\> ");
  });
});

function linuxShell(filesystem: InMemoryFilesystem): ShellSession {
  return new ShellSession(filesystem, {
    computerName: "c-000001",
    osProfile: "linux",
    passwordSalt: (): string => "fixed-test-salt-01",
    requireLogin: true,
  });
}
