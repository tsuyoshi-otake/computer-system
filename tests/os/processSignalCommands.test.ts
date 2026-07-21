import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

const administratorPassword = "signal-commands-password";

describe("CS-Linux pgrep, pkill, and killall", (): void => {
  it("lists matching PIDs by substring and exact name", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());

    const substring = shell.submit("pgrep sys");
    expect(substring.exitCode).toBe(0);
    expect(substring.stdout.trim()).toMatch(/^[0-9]+$/u);

    const named = shell.submit("pgrep -l syslog");
    expect(named.stdout.trim()).toMatch(/^[0-9]+ syslog$/u);

    const exactMismatch = shell.submit("pgrep -x sys");
    expect(exactMismatch.exitCode).toBe(1);
    expect(exactMismatch.stdout).toBe("");

    const exactMatch = shell.submit("pgrep -x syslog");
    expect(exactMatch.exitCode).toBe(0);
    expect(exactMatch.stdout).toBe(named.stdout.split(" ")[0]! + "\n");
  });

  it("reports no matches and a usage error explicitly", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());

    const noMatch = shell.submit("pgrep no-such-service");
    expect(noMatch).toMatchObject({ exitCode: 1, stdout: "" });

    expect(shell.submit("pgrep")).toMatchObject({ exitCode: 2 });
  });

  it("denies pkill against a root-owned process without privilege", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());

    const denied = shell.submit("pkill -x syslog");
    expect(denied.exitCode).toBe(1);
    expect(denied.stderr).toContain("operation not permitted");
    expect(shell.submit("service syslog status").stdout).toContain(
      "syslog is running",
    );
  });

  it("signals a service process with sudo pkill, surfacing an uncoordinated exit as failed", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());
    authorizeSudo(shell);

    expect(shell.submit("sudo -n pkill -x syslog").exitCode).toBe(0);
    expect(shell.submit("service syslog status").stdout).toContain(
      "syslog is failed",
    );
  });

  it("reports exit 1 with no output when pkill matches nothing", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());
    authorizeSudo(shell);

    const result = shell.submit("sudo -n pkill -x no-such-service");
    expect(result).toMatchObject({ exitCode: 1, stderr: "", stdout: "" });
  });

  it("signals multiple named services with sudo killall and reports unmatched names", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());
    authorizeSudo(shell);

    const mixed = shell.submit("sudo -n killall -TERM cron bogus-service");
    expect(mixed.exitCode).toBe(1);
    expect(mixed.stderr).toContain("bogus-service: no process found");
    expect(shell.submit("service cron status").stdout).toContain(
      "cron is failed",
    );

    const allMissing = shell.submit("sudo -n killall bogus-service");
    expect(allMissing).toMatchObject({ exitCode: 1 });
    expect(allMissing.stderr).toBe(
      "killall: bogus-service: no process found\n",
    );
  });
});

function initializedShell(filesystem: InMemoryFilesystem): ShellSession {
  const shell = new ShellSession(filesystem, {
    computerName: "c-signalcmd",
    osProfile: "linux",
    passwordSalt: (): string => "fixed-signal-cmd-salt",
    requireLogin: true,
  });
  expect(shell.prompt()).toBe("New password: ");
  shell.submit(administratorPassword);
  expect(shell.submit(administratorPassword).exitCode).toBe(0);
  return shell;
}

function authorizeSudo(shell: ShellSession): void {
  expect(shell.submit("sudo true").exitCode).toBe(0);
  expect(shell.prompt()).toContain("[sudo] password");
  expect(shell.submit(administratorPassword).exitCode).toBe(0);
}
