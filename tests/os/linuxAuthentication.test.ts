import { describe, expect, it } from "vitest";

import { openLinuxAccountDatabase } from "../../src/application/os/linuxAccounts.js";
import { sha256Hex } from "../../src/application/os/passwordHash.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { OsRuntimeState } from "../../src/application/os/osRuntimeState.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

const linuxMotd =
  "Welcome to CS-Linux 1.0.\nType 'help' for commands or 'man cs-linux' for the field guide.";

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

    expect(shell.takeStartupLines()).toEqual(["CS-Linux 1.0 console tty1"]);
    expect(shell.prompt()).toBe("New password: ");
    expect(shell.isSecretInput()).toBe(true);
    expect(shell.complete("ec", 2).candidates).toEqual([]);
    expect(shell.submit("short").stderr).toContain("at least 8 characters");

    expect(shell.submit("correct-horse").exitCode).toBe(0);
    expect(shell.prompt()).toBe("Retype new password: ");
    expect(filesystem.readFile("/etc/shadow")).toContain("cs:!!");
    expect(shell.submit("different-password").stderr).toContain("do not match");
    expect(shell.prompt()).toBe("New password: ");

    shell.submit("correct-horse");
    expect(shell.submit("correct-horse").stdout).toBe(
      `Password configured.\n${linuxMotd}\n`,
    );
    expect(shell.isSecretInput()).toBe(false);
    expect(shell.prompt()).toBe("cs@c-000001:~$ ");
    expect(shell.submit("whoami").stdout).toBe("cs\n");
    const shadow = filesystem.readFile("/etc/shadow");
    expect(shadow).toMatch(/(?:^|\n)cs:cs-sha256-v1:512:/u);
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
    expect(shell.takeStartupLines()).toEqual(["CS-Linux 1.0 console tty1"]);
    expect(shell.prompt()).toBe("c-000001 login: ");
    expect(shell.submitDebugCommand("whoami").stderr).toContain(
      "login is required",
    );
    expect(shell.submit("cs").exitCode).toBe(0);
    expect(shell.prompt()).toBe("Password: ");
    const firstFailure = shell.submit("wrong-password");
    expect(firstFailure.stderr).toBe("Login incorrect\n");
    expect(firstFailure.sleepTicks).toBeUndefined();
    expect(shell.submit("cs").exitCode).toBe(0);
    const secondFailure = shell.submit("wrong-password");
    expect(secondFailure.stderr).toBe("Login incorrect\n");
    expect(secondFailure.sleepTicks).toBeUndefined();
    expect(shell.submit("cs").exitCode).toBe(0);
    const thirdFailure = shell.submit("wrong-password");
    expect(thirdFailure.stderr).toBe(
      "Login incorrect\nToo many attempts; retrying in 2 seconds.\n",
    );
    expect(thirdFailure.sleepTicks).toBe(40);
    expect(shell.prompt()).toBe("c-000001 login: ");
    expect(shell.submit("cs").exitCode).toBe(0);
    expect(shell.prompt()).toBe("Password: ");
    expect(shell.submit("correct-horse").stdout).toBe(`${linuxMotd}\n`);
    expect(shell.submit("whoami").stdout).toBe("cs\n");
  });

  it("prints MOTD before the prior wall-clock login record", (): void => {
    const filesystem = new InMemoryFilesystem();
    const runtime = new OsRuntimeState("c-000001");
    let wallMilliseconds = Date.UTC(2026, 6, 19, 8, 9, 10);
    const createSession = (): ShellSession =>
      new ShellSession(filesystem, {
        clock: {
          currentGameTime: (): {
            absoluteTicks: number;
            timeOfDay: number;
          } => ({ absoluteTicks: 0, timeOfDay: 0 }),
          currentWallTimeMilliseconds: (): number => wallMilliseconds,
        },
        computerName: "c-000001",
        osProfile: "linux",
        osRuntime: runtime,
        passwordSalt: (): string => "fixed-test-salt-01",
        requireLogin: true,
      });

    const initial = createSession();
    initial.submit("correct-horse");
    initial.submit("correct-horse");
    wallMilliseconds += 5_000;
    initial.disconnect();
    runtime.openLoginSession({
      gid: 1001,
      sessionId: "legacy-alice",
      terminal: "tty2",
      tick: 1,
      uid: 1001,
      username: "alice",
    });

    wallMilliseconds += 45_000;
    const login = createSession();
    expect(login.takeStartupLines()).toEqual(["CS-Linux 1.0 console tty1"]);
    expect(login.prompt()).toBe("c-000001 login: ");
    login.submit("cs");
    expect(login.submit("correct-horse").stdout).toBe(
      `${linuxMotd}\nLast login: Sun Jul 19 08:09:10 2026 on tty1 (disconnect)\n`,
    );
    expect(login.submit("who").stdout).toContain("Sun Jul 19 08:10:00 2026");
    expect(login.submit("who").stdout).toContain("alice");
    expect(login.submit("who").stdout).toContain("tick 1");
    expect(login.submit("last").stdout).toContain("Sun Jul 19 08:10:00 2026");
    expect(login.submit("last").stdout).toContain("alice");
    expect(login.submit("last").stdout).toContain("tick 1");
  });

  it("returns an interrupted first-boot confirmation to setup-new", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = linuxShell(filesystem);

    expect(shell.submit("discarded-candidate").exitCode).toBe(0);
    expect(shell.prompt()).toBe("Retype new password: ");
    shell.disconnect();

    expect(shell.prompt()).toBe("New password: ");
    expect(filesystem.readFile("/etc/shadow")).toContain("cs:!!");
    expect(shell.submit("another-candidate").exitCode).toBe(0);
    expect(shell.prompt()).toBe("Retype new password: ");

    const restarted = linuxShell(filesystem);
    expect(restarted.prompt()).toBe("New password: ");
    expect(restarted.submit("correct-horse").exitCode).toBe(0);
    expect(restarted.submit("correct-horse").stdout).toBe(
      `Password configured.\n${linuxMotd}\n`,
    );
  });

  it("authenticates a renamed non-root account even when its home is missing", (): void => {
    const filesystem = new InMemoryFilesystem();
    const administrator = linuxShell(filesystem);
    administrator.submit("correct-horse");
    administrator.submit("correct-horse");
    filesystem.move("/home/cs", "/home/operator");
    expect(
      openLinuxAccountDatabase(filesystem).updateUser("cs", {
        home: "/home/operator",
        name: "operator",
      }),
    ).toMatchObject({ home: "/home/operator", name: "operator", uid: 1_000 });
    expect(filesystem.exists("/home/cs")).toBe(false);
    filesystem.delete("/home/operator");

    const login = linuxShell(filesystem);
    expect(login.prompt()).toBe("c-000001 login: ");
    expect(login.submit("operator").exitCode).toBe(0);
    expect(login.prompt()).toBe("Password: ");
    expect(() => login.submit("correct-horse")).not.toThrow();
    expect(login.submit("whoami").stdout).toBe("operator\n");
    expect(login.submit("printenv HOME").stdout).toBe("/home/operator\n");
    expect(filesystem.exists("/home/cs")).toBe(false);
    expect(filesystem.exists("/home/operator")).toBe(false);
  });

  it("binds first-boot setup to UID 1000 rather than a reused cs name", (): void => {
    const filesystem = new InMemoryFilesystem();
    const administrator = linuxShell(filesystem);
    administrator.submit("correct-horse");
    administrator.submit("correct-horse");
    filesystem.move("/home/cs", "/home/operator");

    const accounts = openLinuxAccountDatabase(filesystem);
    accounts.updateUser("cs", {
      home: "/home/operator",
      name: "operator",
    });
    expect(accounts.createUser({ name: "cs" })).toMatchObject({
      name: "cs",
      uid: 1_001,
    });

    const login = linuxShell(filesystem);
    expect(login.prompt()).toBe("c-000001 login: ");
    expect(login.submit("operator").exitCode).toBe(0);
    expect(login.prompt()).toBe("Password: ");
    expect(login.submit("correct-horse").stdout).toBe(`${linuxMotd}\n`);
    expect(login.submit("id -u").stdout).toBe("1000\n");
    expect(
      openLinuxAccountDatabase(filesystem).getShadowRecord("cs")?.state,
    ).toBe("unset");
  });

  it("configures the current UID 1000 name when it was renamed before setup", (): void => {
    const filesystem = new InMemoryFilesystem();
    const initialized = linuxShell(filesystem);
    expect(initialized.prompt()).toBe("New password: ");
    initialized.disconnect();
    filesystem.move("/home/cs", "/home/operator");

    const accounts = openLinuxAccountDatabase(filesystem);
    accounts.updateUser("cs", {
      home: "/home/operator",
      name: "operator",
    });
    accounts.createUser({ name: "cs" });

    const setup = linuxShell(filesystem);
    expect(setup.prompt()).toBe("New password: ");
    expect(setup.submit("correct-horse").exitCode).toBe(0);
    expect(setup.submit("correct-horse").stdout).toBe(
      `Password configured.\n${linuxMotd}\n`,
    );
    expect(setup.submit("whoami").stdout).toBe("operator\n");

    const reopened = openLinuxAccountDatabase(filesystem);
    expect(reopened.getShadowRecord("operator")?.state).toBe("hash");
    expect(reopened.getShadowRecord("cs")?.state).toBe("unset");
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
