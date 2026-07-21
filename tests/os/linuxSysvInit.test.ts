import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

const administratorPassword = "sysv-init-password";

describe("CS-Linux SysV init primitives", (): void => {
  it("auto-starts rc.d services from inittab on a fresh boot and journals it", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());

    expect(shell.submit("service --status-all").stdout).toContain(
      "[ + ] syslog",
    );
    expect(shell.submit("service --status-all").stdout).toContain("[ + ] cron");
    const dmesg = shell.submit("dmesg").stdout;
    expect(dmesg).toContain("syslog service started as process");
    expect(dmesg).toContain("cron service started as process");
  });

  it("reports runlevel before and after telinit transitions services per the rc.d farm", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());
    authorizeSudo(shell);

    expect(shell.submit("runlevel").stdout).toBe("unknown\n");

    expect(shell.submit("sudo -n cs-init-ctl syslog start").exitCode).toBe(0);
    expect(shell.submit("sudo -n cs-init-ctl cron start").exitCode).toBe(0);
    expect(shell.submit("service syslog status").stdout).toContain(
      "syslog is running",
    );

    expect(shell.submit("sudo -n telinit 3").exitCode).toBe(0);
    expect(shell.submit("runlevel").stdout).toBe("N 3\n");

    expect(shell.submit("sudo -n telinit 1").exitCode).toBe(0);
    expect(shell.submit("runlevel").stdout).toBe("3 1\n");
    expect(shell.submit("service syslog status").stdout).toContain(
      "syslog is inactive",
    );
    expect(shell.submit("service cron status").stdout).toContain(
      "cron is inactive",
    );

    expect(shell.submit("sudo -n telinit 3").exitCode).toBe(0);
    expect(shell.submit("runlevel").stdout).toBe("1 3\n");
    expect(shell.submit("service syslog status").stdout).toContain(
      "syslog is running",
    );
    expect(shell.submit("service cron status").stdout).toContain(
      "cron is running",
    );
  });

  it("maps telinit 0/6 to the existing shutdown/reboot actions and denies non-root callers", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());

    const denied = shell.submit("telinit 3");
    expect(denied.exitCode).toBe(1);
    expect(denied.stderr).toContain("must be superuser");

    authorizeSudo(shell);
    expect(shell.submit("sudo -n telinit 0").action).toBe("shutdown");
    expect(shell.submit("sudo -n telinit 6").action).toBe("reboot");
    expect(shell.submit("sudo -n telinit 9").exitCode).toBe(1);
    expect(shell.submit("sudo -n init 3").exitCode).toBe(0);
  });

  it("keeps `service <name> start` rejected; mutation flows only through cs-init-ctl", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());
    authorizeSudo(shell);

    expect(shell.submit("sudo -n cs-init-ctl syslog start").exitCode).toBe(0);
    const rejected = shell.submit("sudo -n service syslog start");
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("managed by cs-init");

    const unknown = shell.submit("sudo -n cs-init-ctl bogus start");
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("unrecognized service");
  });

  it("runs /etc/init.d/<name> directly and fails explicitly when the script is removed or non-executable", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());
    authorizeSudo(shell);

    expect(shell.submit("sudo -n /etc/init.d/syslog start").exitCode).toBe(0);
    expect(shell.submit("service syslog status").stdout).toContain(
      "syslog is running",
    );
    expect(shell.submit("sudo -n /etc/init.d/syslog status").exitCode).toBe(0);
    expect(shell.submit("sudo -n /etc/init.d/syslog stop").exitCode).toBe(0);
    expect(shell.submit("service syslog status").stdout).toContain(
      "syslog is inactive",
    );
    expect(
      shell.submit("sudo -n /etc/init.d/syslog bogus-action"),
    ).toMatchObject({ exitCode: 2 });

    expect(shell.submit("sudo -n chmod 644 /etc/init.d/syslog").exitCode).toBe(
      0,
    );
    const permissionDenied = shell.submit("sudo -n /etc/init.d/syslog start");
    expect(permissionDenied.exitCode).toBe(126);
    expect(permissionDenied.stderr).toContain("Permission denied");
    expect(shell.submit("sudo -n cs-init-ctl syslog start").exitCode).toBe(0);

    expect(shell.submit("sudo -n rm /etc/init.d/cron").exitCode).toBe(0);
    const missing = shell.submit("sudo -n /etc/init.d/cron start");
    expect(missing.exitCode).toBe(127);
    expect(missing.stderr).toContain("No such file or directory");
  });
});

function initializedShell(filesystem: InMemoryFilesystem): ShellSession {
  const shell = new ShellSession(filesystem, {
    computerName: "c-sysvinit",
    osProfile: "linux",
    passwordSalt: (): string => "fixed-sysvinit-salt",
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
