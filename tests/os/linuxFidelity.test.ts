import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("CS-Linux fidelity", (): void => {
  it("reports a coherent Linux identity, clock, mounts, and proc files", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem(), {
      clock: {
        currentGameTime: (): { absoluteTicks: number; timeOfDay: number } => ({
          absoluteTicks: 0,
          timeOfDay: 0,
        }),
        currentWallTimeMilliseconds: (): number =>
          Date.UTC(2026, 6, 14, 12, 34, 56),
      },
      computerName: "c-linux1",
      currentTick: (): number => 1_200,
      ticksPerSecond: 20,
    });

    expect(shell.submit("id").stdout).toBe(
      "uid=1000(cs) gid=1000(cs) groups=1000(cs),27(sudo)\n",
    );
    expect(shell.submit("id -u").stdout).toBe("1000\n");
    expect(shell.submit("groups").stdout).toBe("cs sudo\n");
    expect(shell.submit("uname -snrmo").stdout).toBe(
      "Linux c-linux1 1.0.0-cs i486 GNU/Linux\n",
    );
    expect(shell.submit("date").stdout).toBe("Tue Jul 14 12:34:56 UTC 2026\n");
    expect(shell.submit("mount").stdout).toContain(
      "proc on /proc type proc (ro,nosuid,nodev,noexec)\n",
    );
    expect(shell.submit("cat /proc/version").stdout).toContain(
      "Linux version 1.0.0-cs",
    );
    expect(shell.submit("cat /proc/loadavg").stdout).toBe(
      "0.00 0.00 0.00 2/5 5\n",
    );
    expect(shell.submit("cat /proc/mounts").stdout).toContain(
      "computer-system / csfs rw,nosuid,nodev 0 0\n",
    );
    expect(shell.submit("df -h").stdout).toContain("Mounted on\n");
    expect(shell.submit("du -sh /etc").stdout).toMatch(
      /^[0-9.]+[BKM]\t\/etc\n$/u,
    );
  });

  it("persists permissions and implements symbolic and hard links", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    shell.submit("mkdir -p work/empty");
    shell.submit("echo original > work/source");
    expect(shell.submit("chmod 640 work/source").exitCode).toBe(0);
    expect(shell.submit("ln work/source work/hard").exitCode).toBe(0);
    expect(shell.submit("ln -s source work/symbolic").exitCode).toBe(0);
    expect(shell.submit("echo changed > work/hard").exitCode).toBe(0);
    expect(shell.submit("cat work/source").stdout).toBe("changed\n");
    expect(shell.submit("cat work/symbolic").stdout).toBe("changed\n");
    expect(shell.submit("readlink work/symbolic").stdout).toBe("source\n");
    expect(shell.submit("realpath work/symbolic").stdout).toBe(
      "/home/cs/work/source\n",
    );
    expect(shell.submit("stat work/source").stdout).toContain("Links: 2\n");
    expect(shell.submit("ls -l work").stdout).toContain("-rw-r-----");
    expect(shell.submit("ls -l work").stdout).toContain("symbolic -> source");
    expect(shell.submit("rmdir work/empty").exitCode).toBe(0);
    expect(shell.submit("chmod 600 /etc/passwd").stderr).toContain(
      "Operation not permitted",
    );
    expect(shell.submit("echo blocked > /etc/blocked").stderr).toContain(
      "Permission denied",
    );
    expect(shell.submit("chown root work/source").stderr).toContain(
      "Operation not permitted",
    );
  });

  it("provides bounded Linux text, hash, inspection, and temporary utilities", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());

    expect(shell.submit("printf abc | tee /tmp/value").stdout).toBe("abc");
    expect(shell.submit("sha256sum /tmp/value").stdout).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  /tmp/value\n",
    );
    expect(shell.submit("file /tmp/value").stdout).toBe(
      "/tmp/value: Unicode text, UTF-8 text\n",
    );
    shell.submit("printf abd > /tmp/other");
    expect(shell.submit("cmp /tmp/value /tmp/other").exitCode).toBe(1);
    expect(shell.submit("diff -u /tmp/value /tmp/other").stdout).toContain(
      "-abc",
    );
    expect(shell.submit("hexdump -C /tmp/value").stdout).toContain("61 62 63");
    expect(shell.submit("mktemp").stdout).toMatch(
      /^\/tmp\/tmp\.[a-z0-9]{6}\n$/u,
    );
    expect(shell.submit("printenv HOME").stdout).toBe("/home/cs\n");
    expect(shell.submit("printf 'one two' | xargs echo").stdout).toBe(
      "one two\n",
    );
    const boundedYes = shell.submit("yes test");
    expect(boundedYes.exitCode).toBe(1);
    expect(boundedYes.stderr).toBe("yes: bounded output limit reached\n");
    expect(boundedYes.lines).toHaveLength(1_025);
  });

  it("supports bounded Bash aliases and stateful builtins", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());

    expect(shell.submit("alias hi='echo alias-ok'").exitCode).toBe(0);
    expect(shell.submit("hi").stdout).toBe("alias-ok\n");
    expect(shell.submit("command -v hi").stdout).toBe("hi\n");
    expect(shell.submit("unalias hi").exitCode).toBe(0);
    expect(shell.submit("hi").exitCode).toBe(127);
    expect(shell.submit("printf 'value\\n' | read RESULT").exitCode).toBe(0);
    expect(shell.submit("echo $RESULT").stdout).toBe("value\n");

    const script = [
      "demo() {",
      "  local VALUE=inside",
      "  shift",
      "  echo $VALUE:$1",
      "}",
      "VALUE=outside",
      "demo first second",
      "echo $VALUE",
      "parse() {",
      '  getopts "a:" OPTION',
      "  echo $OPTION:$OPTARG:$OPTIND",
      "}",
      "OPTIND=1",
      "parse -a option-value",
    ].join("\n");
    expect(shell.submit(`bash -c '${script}'`).stdout).toBe(
      "inside:second\noutside\na:option-value:3\n",
    );
  });
});
