import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

const administratorPassword = "correct-horse";
const alicePassword = "alice-password";

describe("CS-Linux multi-user sessions", (): void => {
  it("keeps root locked, scopes sudo, and restores the caller after elevated shells", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = initializedShell(filesystem);

    expect(shell.submit("whoami").stdout).toBe("cs\n");
    expect(shell.submit("echo $PATH").stdout).toBe(
      "/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games\n",
    );
    expect(shell.submit("id").stdout).toContain("uid=1000(cs)");
    expect(shell.submit("groups").stdout).toContain("sudo");
    expect(shell.submit("su -").stderr).toContain("Authentication failure");
    const debugInteractiveSudo = shell.submitDebugCommand("sudo whoami");
    expect(debugInteractiveSudo.exitCode).toBe(2);
    expect(debugInteractiveSudo.stderr).toContain("requires sudo -n");
    expect(shell.prompt()).toBe("cs@c-multi1:~$ ");

    const nonInteractiveSudo = shell.submit("sudo -n whoami");
    expect(nonInteractiveSudo.exitCode).toBe(1);
    expect(nonInteractiveSudo.stderr).toContain("password is required");
    expect(shell.submit("sudo whoami").exitCode).toBe(0);
    expect(shell.prompt()).toBe("[sudo] password for cs: ");
    expect(shell.isSecretInput()).toBe(true);
    expect(shell.submit(administratorPassword).stdout).toBe("root\n");
    expect(shell.submit("sudo -n whoami").stdout).toBe("root\n");
    const debugLoginSudo = shell.submitDebugCommand("sudo -i");
    expect(debugLoginSudo.exitCode).toBe(2);
    expect(debugLoginSudo.stderr).toContain("requires sudo -n");
    const debugLogout = shell.submitDebugCommand("logout");
    expect(debugLogout.exitCode).toBe(2);
    expect(debugLogout.stderr).toContain("session control is not supported");
    expect(shell.submitDebugCommand("sudo -n whoami").stdout).toBe("root\n");

    expect(shell.submit("sudo -i").exitCode).toBe(0);
    expect(shell.prompt()).toBe("root@c-multi1:~# ");
    expect(shell.submit("whoami").stdout).toBe("root\n");
    expect(shell.submit("pwd").stdout).toBe("/root\n");
    expect(shell.submit("echo $PATH").stdout).toBe(
      "/usr/local/sbin:/usr/sbin:/sbin:/usr/local/bin:/usr/bin:/bin\n",
    );
    const elevatedExit = shell.submit("exit");
    expect(elevatedExit).toMatchObject({
      exitCode: 0,
      stdout: "logout\n",
    });
    expect(elevatedExit.action).toBeUndefined();
    expect(shell.prompt()).toBe("cs@c-multi1:~$ ");
    expect(shell.submit("whoami").stdout).toBe("cs\n");
    expect(shell.submit("echo $PATH").stdout).toBe(
      "/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games\n",
    );

    expect(shell.submit("sudo passwd root").exitCode).toBe(0);
    expect(shell.prompt()).toBe("New password: ");
    shell.submit("root-password");
    expect(shell.prompt()).toBe("Retype new password: ");
    expect(shell.submit("root-password").stdout).toContain(
      "updated successfully",
    );
    expect(shell.submit("su -").exitCode).toBe(0);
    expect(shell.prompt()).toBe("Password: ");
    expect(shell.submit("root-password").exitCode).toBe(0);
    expect(shell.submit("whoami").stdout).toBe("root\n");
    shell.submit("exit");
    expect(shell.submit("whoami").stdout).toBe("cs\n");
  });

  it("adds, modifies, authenticates, and removes users without bypassing DAC", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = initializedShell(filesystem);
    authorizeSudo(shell);

    expect(shell.submit("sudo groupadd dev").exitCode).toBe(0);
    expect(shell.submit("sudo useradd -G dev alice").exitCode).toBe(0);
    expect(shell.submit("getent passwd alice").stdout).toContain(
      "alice:x:1001:1002::/home/alice:/bin/bash",
    );
    expect(shell.submit("getent group dev").stdout).toContain(
      "dev:x:1001:alice",
    );
    expect(filesystem.getMetadata("/home/alice")).toMatchObject({
      gid: 1002,
      mode: 0o700,
      uid: 1001,
    });

    expect(shell.submit("sudo passwd alice").exitCode).toBe(0);
    shell.submit(alicePassword);
    expect(shell.submit(alicePassword).stdout).toContain(
      "updated successfully",
    );
    expect(shell.submit("sudo -u alice -i").exitCode).toBe(0);
    expect(shell.submit("whoami").stdout).toBe("alice\n");
    expect(shell.submit("groups").stdout).toContain("dev");
    expect(shell.submit("umask 077").exitCode).toBe(0);
    expect(shell.submit("echo private > secret").exitCode).toBe(0);
    expect(filesystem.getMetadata("/home/alice/secret")).toMatchObject({
      gid: 1002,
      mode: 0o600,
      uid: 1001,
    });
    expect(shell.submit("echo sticky > /tmp/alice-note").exitCode).toBe(0);
    shell.submit("exit");

    expect(shell.submit("cat /home/alice/secret").stderr).toContain(
      "Permission denied",
    );
    expect(shell.submit("rm /tmp/alice-note").stderr).toContain(
      "Operation not permitted",
    );
    expect(shell.submit("sudo -n cat /home/alice/secret").stdout).toBe(
      "private\n",
    );

    expect(
      shell.submit("sudo usermod -l ally -d /home/ally -m -aG sudo alice")
        .exitCode,
    ).toBe(0);
    expect(filesystem.exists("/home/alice")).toBe(false);
    expect(filesystem.isDirectory("/home/ally")).toBe(true);
    expect(shell.submit("getent passwd ally").stdout).toContain("/home/ally");
    expect(shell.submit("sudo userdel -r ally").exitCode).toBe(0);
    expect(filesystem.exists("/home/ally")).toBe(false);
    expect(shell.submit("sudo groupdel dev").exitCode).toBe(0);
    expect(shell.submit("getent passwd ally").exitCode).toBe(2);
  });

  it("runs startup files only after username/password login and clears sudo state on logout", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = initializedShell(filesystem);
    authorizeSudo(shell);
    shell.submit("sudo useradd alice");
    shell.submit("sudo passwd alice");
    shell.submit(alicePassword);
    shell.submit(alicePassword);

    const logout = shell.submit("logout");
    expect(logout).toMatchObject({
      exitCode: 0,
      stdout: "logout\n",
    });
    expect(logout.action).toBeUndefined();
    expect(shell.prompt()).toBe("c-multi1 login: ");
    expect(shell.submitDebugCommand("whoami").stderr).toContain(
      "login is required",
    );
    expect(shell.submit("alice").exitCode).toBe(0);
    expect(shell.prompt()).toBe("Password: ");
    expect(shell.submit(alicePassword).exitCode).toBe(0);
    expect(shell.submit("whoami").stdout).toBe("alice\n");
    expect(shell.submit("sudo -n whoami").stderr).toContain(
      "not in the sudo group",
    );

    shell.submit("exit");
    expect(shell.prompt()).toBe("c-multi1 login: ");
    shell.submit("cs");
    shell.submit(administratorPassword);
    expect(shell.submit("sudo -n whoami").stderr).toContain(
      "password is required",
    );
  });

  it("does not let sudo hide the authenticated account from active-user checks", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());
    authorizeSudo(shell);
    shell.submit("sudo useradd -G sudo alice");
    shell.submit("sudo passwd alice");
    shell.submit(alicePassword);
    shell.submit(alicePassword);
    shell.submit("logout");
    shell.submit("alice");
    shell.submit(alicePassword);

    shell.submit("sudo userdel alice");
    expect(shell.submit(alicePassword).stderr).toContain(
      "cannot remove an active account",
    );
    expect(shell.submit("getent passwd alice").exitCode).toBe(0);
    expect(shell.submit("whoami").stdout).toBe("alice\n");
  });

  it("keeps login usable without a home and rejects live home changes", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = initializedShell(filesystem);
    authorizeSudo(shell);

    const liveMove = shell.submit("sudo usermod -d /home/moved-cs -m cs");
    expect(liveMove.exitCode).toBe(1);
    expect(liveMove.stderr).toContain("home of an active account");
    expect(filesystem.exists("/home/cs")).toBe(true);
    expect(filesystem.exists("/home/moved-cs")).toBe(false);

    expect(shell.submit("sudo useradd -M nomad").exitCode).toBe(0);
    expect(filesystem.exists("/home/nomad")).toBe(false);
    expect(shell.submit("sudo passwd nomad").exitCode).toBe(0);
    shell.submit("nomad-password");
    shell.submit("nomad-password");
    shell.submit("logout");
    shell.submit("nomad");
    const login = shell.submit("nomad-password");

    expect(login.exitCode).toBe(0);
    expect(login.stderr).toContain(
      "Could not chdir to home directory /home/nomad: No such file or directory",
    );
    expect(shell.submit("whoami").stdout).toBe("nomad\n");
    expect(shell.submit("pwd").stdout).toBe("/\n");
    expect(shell.submit("echo $HOME").stdout).toBe("/home/nomad\n");
  });

  it("provisions fixed user home modes independently of the caller umask", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = initializedShell(filesystem);
    authorizeSudo(shell);
    expect(shell.submit("umask 0777").exitCode).toBe(0);

    expect(shell.submit("sudo -n useradd masked").exitCode).toBe(0);

    expect(filesystem.getMetadata("/home/masked")).toMatchObject({
      mode: 0o700,
      uid: 1_001,
    });
    expect(filesystem.getMetadata("/home/masked/.bashrc")).toMatchObject({
      mode: 0o644,
      uid: 1_001,
    });
  });

  it("leaves neither an account nor partial home ancestors when useradd runs out of entries", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = initializedShell(filesystem);
    authorizeSudo(shell);
    const fillers: string[] = [];
    for (let index = 0; index < filesystem.limits.maxEntries; index += 1) {
      const path = `/tmp/useradd-filler-${String(index)}`;
      try {
        filesystem.writeFile(path, "");
        fillers.push(path);
      } catch (error: unknown) {
        expect(error).toMatchObject({ code: "entry_limit" });
        break;
      }
    }
    expect(fillers.length).toBeGreaterThan(0);
    filesystem.delete(fillers.at(-1)!);

    const addition = shell.submit(
      "sudo -n useradd -d /home/partial/final alice",
    );

    expect(addition.exitCode).toBe(1);
    expect(addition.stderr).toContain("entry limit");
    expect(filesystem.exists("/home/partial")).toBe(false);
    expect(filesystem.exists("/home/partial/final")).toBe(false);
    expect(shell.submit("getent passwd alice").exitCode).toBe(2);
  });

  it("protects the UID 1000 boot service account from deletion", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());
    authorizeSudo(shell);
    expect(shell.submit("sudo passwd root").exitCode).toBe(0);
    shell.submit("root-password");
    shell.submit("root-password");
    shell.submit("logout");
    shell.submit("root");
    shell.submit("root-password");

    const deletion = shell.submit("userdel cs");
    expect(deletion.exitCode).toBe(1);
    expect(deletion.stderr).toContain("UID 1000 boot service account");
    expect(shell.submit("getent passwd cs").exitCode).toBe(0);
  });

  it("does not reveal inaccessible vi targets through an unchecked exists call", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());
    authorizeSudo(shell);
    expect(shell.submit("sudo -n mkdir /private").exitCode).toBe(0);
    expect(shell.submit("sudo -n chmod 700 /private").exitCode).toBe(0);

    const opened = shell.submit("vi /private/unknown");
    expect(opened.exitCode).not.toBe(0);
    expect(opened.stderr).toContain("Permission denied");
    expect(opened.terminalScreen).toBeUndefined();
  });

  it("restores bounded shell state after a nested login identity exits", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());
    authorizeSudo(shell);
    shell.submit("export CALLER=keep");
    shell.submit("alias 'greet=echo caller-alias'");
    shell.submit("echo 'greetfn() {' > /home/cs/caller-functions.sh");
    shell.submit("echo 'echo caller-function' >> /home/cs/caller-functions.sh");
    shell.submit("echo '}' >> /home/cs/caller-functions.sh");
    shell.submit("source /home/cs/caller-functions.sh");
    shell.submit("cd /tmp");
    shell.submit("cd /home/cs");
    shell.submit("umask 027");

    expect(shell.submit("sudo -i").exitCode).toBe(0);
    expect(shell.submit("printenv CALLER").exitCode).toBe(1);
    expect(shell.submit("greet").exitCode).toBe(127);
    expect(shell.submit("history").stdout).not.toContain("CALLER=keep");
    shell.submit("export CALLER=root ROOT_ONLY=value");
    shell.submit("alias 'greet=echo root-alias'");
    shell.submit("echo 'greetfn() {' > /root/root-functions.sh");
    shell.submit("echo 'echo root-function' >> /root/root-functions.sh");
    shell.submit("echo '}' >> /root/root-functions.sh");
    shell.submit("source /root/root-functions.sh");
    shell.submit("cd /");
    shell.submit("umask 077");
    shell.submit("exit");

    expect(shell.submit("printenv CALLER").stdout).toBe("keep\n");
    expect(shell.submit("printenv ROOT_ONLY").exitCode).toBe(1);
    expect(shell.submit("greet").stdout).toBe("caller-alias\n");
    expect(shell.submit("greetfn").stdout).toBe("caller-function\n");
    expect(shell.submit("pwd").stdout).toBe("/home/cs\n");
    expect(shell.submit("echo $OLDPWD").stdout).toBe("/tmp\n");
    expect(shell.submit("umask").stdout).toBe("0027\n");
    expect(shell.submit("history").stdout).not.toContain("ROOT_ONLY=value");
  });

  it("does not let scoped sudo commands leave session state or identity frames", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());
    authorizeSudo(shell);
    shell.submit("export SCOPE=caller");
    shell.submit("alias 'become=sudo -i'");
    shell.submit("alias 'leave=exit'");

    for (const command of [
      "sudo sudo -i",
      "sudo su -",
      "sudo become",
      "sudo leave",
      "sudo vi /etc/shadow",
    ]) {
      expect(shell.submit(command).exitCode, command).not.toBe(0);
      expect(shell.submit("whoami").stdout, command).toBe("cs\n");
      expect(shell.prompt(), command).toBe("cs@c-multi1:~$ ");
    }

    expect(shell.submit("sudo export SCOPE=root").exitCode).toBe(0);
    expect(shell.submit("printenv SCOPE").stdout).toBe("caller\n");
    expect(shell.submit("exit").stdout).toBe("logout\n");
    expect(shell.prompt()).toBe("c-multi1 login: ");
  });

  it("requires the installed executable before dispatching session account commands", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());
    authorizeSudo(shell);

    expect(shell.submit("sudo -n rm /usr/bin/sudo").exitCode).toBe(0);
    expect(shell.submit("sudo -n whoami")).toMatchObject({ exitCode: 127 });
  });

  it("protects managed account files and keeps scripts from owning session state", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());
    authorizeSudo(shell);

    const accountWrite = shell.submit("sudo -n rm /etc/passwd");
    expect(accountWrite.exitCode).not.toBe(0);
    expect(accountWrite.stderr).toContain("managed account database");
    expect(shell.submit("getent passwd cs").stdout).toContain("cs:x:1000:1000");

    shell.submit("echo logout > /home/cs/logout.sh");
    const scriptedLogout = shell.submit("sh /home/cs/logout.sh");
    expect(scriptedLogout.exitCode).toBe(2);
    expect(scriptedLogout.stderr).toContain("cannot control the login session");
    expect(shell.isAuthenticated()).toBe(true);
    expect(shell.submit("whoami").stdout).toBe("cs\n");

    shell.submit("sudo -k");
    shell.submit("echo 'sudo whoami' > /home/cs/sudo.sh");
    const scriptedSudo = shell.submit("sh /home/cs/sudo.sh");
    expect(scriptedSudo.exitCode).toBe(2);
    expect(scriptedSudo.stderr).toContain(
      "password prompt requires a single interactive command",
    );
    expect(shell.isSecretInput()).toBe(false);
  });

  it("cancels secret and elevated state when the final terminal disconnects", (): void => {
    const shell = initializedShell(new InMemoryFilesystem());
    authorizeSudo(shell);
    expect(shell.submit("sudo -i").exitCode).toBe(0);
    expect(shell.submit("whoami").stdout).toBe("root\n");

    shell.disconnect();

    expect(shell.isAuthenticated()).toBe(false);
    expect(shell.isSecretInput()).toBe(false);
    expect(shell.prompt()).toBe("c-multi1 login: ");
    expect(shell.submitDebugCommand("whoami").stderr).toContain(
      "login is required",
    );
    shell.submit("cs");
    shell.submit(administratorPassword);
    expect(shell.submit("whoami").stdout).toBe("cs\n");
    expect(shell.submit("sudo -n whoami").stderr).toContain(
      "password is required",
    );
  });

  it("refreshes authoritative groups after disconnect when login is disabled", (): void => {
    const filesystem = new InMemoryFilesystem();
    initializedShell(filesystem).disconnect();
    const shell = new ShellSession(filesystem, {
      computerName: "c-disabled1",
      osProfile: "linux",
      passwordSalt: (): string => "fixed-test-salt-01",
      requireLogin: false,
    });
    authorizeSudo(shell);
    expect(shell.submit("sudo -n groupadd dev").exitCode).toBe(0);
    expect(shell.submit("sudo -i").exitCode).toBe(0);
    expect(shell.submit("usermod -G dev cs").exitCode).toBe(0);
    expect(shell.submit("cd /root").exitCode).toBe(0);
    expect(shell.submit("export ROOT_ONLY=secret").exitCode).toBe(0);

    expect(shell.disconnect()).toEqual([]);
    expect(shell.disconnect()).toEqual([]);

    expect(shell.isAuthenticated()).toBe(true);
    expect(shell.submit("groups").stdout).toBe("cs dev\n");
    expect(shell.submit("pwd").stdout).toBe("/home/cs\n");
    expect(shell.submit("echo $HOME").stdout).toBe("/home/cs\n");
    expect(shell.submit("echo $USER").stdout).toBe("cs\n");
    expect(shell.submit("printenv ROOT_ONLY").exitCode).toBe(1);
    const sudo = shell.submit("sudo -n whoami");
    expect(sudo.exitCode).toBe(1);
    expect(sudo.stderr).toContain("cs is not in the sudo group");
  });

  it("falls back to root directory explicitly when a disabled-login home disappeared", (): void => {
    const filesystem = new InMemoryFilesystem();
    initializedShell(filesystem).disconnect();
    const shell = new ShellSession(filesystem, {
      computerName: "c-disabled2",
      osProfile: "linux",
      passwordSalt: (): string => "fixed-test-salt-01",
      requireLogin: false,
    });
    authorizeSudo(shell);
    expect(shell.submit("sudo -i").exitCode).toBe(0);
    expect(shell.submit("export ROOT_ONLY=secret").exitCode).toBe(0);
    expect(shell.submit("rm -r /home/cs").exitCode).toBe(0);

    expect(shell.disconnect()).toEqual([
      "Could not chdir to home directory /home/cs: No such file or directory",
    ]);
    expect(shell.disconnect()).toEqual([]);

    expect(shell.submit("pwd").stdout).toBe("/\n");
    expect(shell.submit("echo $HOME").stdout).toBe("/home/cs\n");
    expect(shell.submit("echo $USER").stdout).toBe("cs\n");
    expect(shell.submit("printenv ROOT_ONLY").exitCode).toBe(1);
  });
});

function initializedShell(filesystem: InMemoryFilesystem): ShellSession {
  const shell = new ShellSession(filesystem, {
    computerName: "c-multi1",
    osProfile: "linux",
    passwordSalt: (): string => "fixed-test-salt-01",
    requireLogin: true,
  });
  expect(shell.prompt()).toBe("New password: ");
  shell.submit(administratorPassword);
  expect(shell.submit(administratorPassword).exitCode).toBe(0);
  return shell;
}

function authorizeSudo(shell: ShellSession): void {
  expect(shell.submit("sudo true").exitCode).toBe(0);
  expect(shell.prompt()).toBe("[sudo] password for cs: ");
  expect(shell.submit(administratorPassword).exitCode).toBe(0);
}
