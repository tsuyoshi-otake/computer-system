import { describe, expect, it } from "vitest";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("Computer System Linux shell and editor", (): void => {
  it("lists and reads files and reports unknown commands", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.writeFile("/hello.py", "print('hi')");
    const shell = new ShellSession(filesystem);
    expect(shell.prompt()).toBe("~$ ");
    expect(shell.submit("ls /").lines[0]).toContain("hello.py");
    expect(shell.submit("cat /hello.py").lines).toEqual(["print('hi')"]);
    expect(shell.submit("wat").lines).toEqual(["bash: wat: command not found"]);
  });

  it("saves and discards full-screen EDIT buffers explicitly", (): void => {
    const filesystem = new InMemoryFilesystem();
    const linux = new ShellSession(filesystem);
    expect(linux.submit("edit /startup.py")).toMatchObject({ exitCode: 127 });
    expect(linux.submit("which edit")).toMatchObject({ exitCode: 1 });

    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    expect(shell.submit("EDIT C:\\STARTUP.TXT").terminalScreen).toBeDefined();
    shell.keys([..."import redstone", "Enter"]);
    shell.keys([...'print("ready")']);
    expect(shell.keys(["Ctrl+s"]).terminalScreen).toBeDefined();
    expect(filesystem.readFile("/drives/c/startup.txt")).toBe(
      'import redstone\nprint("ready")',
    );
    expect(shell.keys(["Alt+f", "x"]).resetTerminal).toBe(true);

    shell.submit("EDIT C:\\DISCARD.TXT");
    shell.keys([..."discard me", "Alt+f", "x"]);
    expect(shell.keys(["n"]).resetTerminal).toBe(true);
    expect(filesystem.exists("/drives/c/discard.txt")).toBe(false);
  });

  it("returns explicit lifecycle actions", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());
    expect(shell.submit("shutdown").action).toBe("shutdown");
    expect(shell.submit("reboot").action).toBe("reboot");
    expect(shell.submit("clear").action).toBe("clear");
  });

  it("executes bounded MCP debug commands without entering TUI state", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    expect(shell.submitDebugCommand("echo debug")).toMatchObject({
      exitCode: 0,
      stdout: "debug\n",
      stderr: "",
    });
    expect(shell.submitDebugCommand("vi /tmp/debug.txt")).toMatchObject({
      exitCode: 2,
      stderr: "debug: TUI commands are not supported through MCP\n",
    });
    expect(shell.submitDebugCommand("edit /tmp/debug.txt")).toMatchObject({
      exitCode: 127,
      stderr: "bash: edit: command not found\n",
    });
    const dosShell = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });
    expect(dosShell.submitDebugCommand("EDIT C:\\DEBUG.TXT")).toMatchObject({
      exitCode: 2,
      stderr: "debug: TUI commands are not supported through MCP\n",
    });
    expect(shell.prompt()).toBe("~$ ");
    expect(shell.submitDebugCommand("shutdown")).toMatchObject({
      exitCode: 2,
      stderr:
        "debug: asynchronous and terminal-control commands are not supported through MCP\n",
    });
  });

  it("supports relative paths and BusyBox-style file commands", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    expect(shell.submit("mkdir -p work/data").exitCode).toBe(0);
    expect(shell.submit("cd work").exitCode).toBe(0);
    expect(shell.submit("pwd").lines).toEqual(["/home/computer/work"]);
    expect(shell.submit("touch data/empty").exitCode).toBe(0);
    expect(shell.submit("echo hello > data/message").lines).toEqual([]);
    expect(shell.submit("echo world >> data/message").exitCode).toBe(0);
    expect(shell.submit("cp data/message data/copy").exitCode).toBe(0);
    expect(shell.submit("mv data/copy data/moved").exitCode).toBe(0);
    expect(shell.submit("ls -la data").lines).toEqual([
      "file       0 empty",
      "file      12 message",
      "file      12 moved",
    ]);
    expect(shell.submit("rm data/moved").exitCode).toBe(0);
    expect(shell.submit("find . -name 'm*'").lines).toEqual([
      "/home/computer/work/data/message",
    ]);
  });

  it("runs bounded pipelines and text filters", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());

    expect(
      shell.submit("printf 'pear\\napple\\npear\\n' | sort | uniq -c").lines,
    ).toEqual(["      1 apple", "      2 pear"]);
    expect(
      shell.submit("printf 'alpha\\nbeta\\nalpine\\n' | grep -n alp | wc -l")
        .lines,
    ).toEqual(["      2"]);
    expect(shell.submit("printf 'abc' | tr abc xyz").lines).toEqual(["xyz"]);
    expect(shell.submit("printf '1\\n2\\n3\\n' | tail -2").lines).toEqual([
      "2",
      "3",
    ]);
  });

  it("completes commands and filesystem paths at the cursor", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());
    expect(shell.complete("who", 3)).toEqual({
      candidates: ["whoami"],
      cursor: 7,
      value: "whoami ",
    });
    expect(shell.complete("cat /et", 7)).toEqual({
      candidates: ["/etc/"],
      cursor: 9,
      value: "cat /etc/",
    });
    expect(shell.complete("s", 1).candidates.length).toBeGreaterThan(1);
  });

  it("loads system and user bashrc files without replacing user content", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/home/computer");
    filesystem.writeFile(
      "/home/computer/.bashrc",
      "export FAVORITE=doraemon\n",
    );

    const shell = new ShellSession(filesystem);

    expect(shell.submit("echo $HISTSIZE:$FAVORITE").lines).toEqual([
      "100:doraemon",
    ]);
    expect(filesystem.readFile("/home/computer/.bashrc")).toBe(
      "export FAVORITE=doraemon\n",
    );
  });

  it("supports redirects, quotes, variables, exit status, and control operators", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());

    expect(shell.submit("NAME='computer system'").exitCode).toBe(0);
    expect(shell.submit('echo "$NAME"').lines).toEqual(["computer system"]);
    expect(shell.submit("false; echo $?").lines).toEqual(["1"]);
    expect(shell.submit("false && echo no || echo yes").lines).toEqual(["yes"]);
    expect(shell.submit("true || echo no; echo done").lines).toEqual(["done"]);
    expect(shell.submit("printf input > file; cat < file").lines).toEqual([
      "input",
    ]);
    expect(shell.submit("echo 'unterminated").exitCode).toBe(2);
    expect(shell.submit("echo 'unterminated").lines[0]).toMatch(
      /syntax error/u,
    );
  });

  it("executes sh and bash scripts inside the sandbox", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile(
      "/script.sh",
      "echo first\nprintf 'second\\n' | tr a-z A-Z\nfalse || echo recovered",
    );

    expect(shell.submit("bash --version").lines[0]).toMatch(
      /Computer System Bash/u,
    );
    expect(shell.submit("sh /script.sh").lines).toEqual([
      "first",
      "SECOND",
      "recovered",
    ]);
    expect(shell.submit('bash -c "echo inline | wc -w"').lines).toEqual([
      "      1",
    ]);
  });

  it("supports bounded Bash arguments, conditionals, loops, and functions", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile(
      "/advanced.sh",
      [
        "#!/usr/bin/env bash",
        "greet() {",
        '  echo "hello $1"',
        "}",
        'if test "$#" -gt 1; then',
        '  for name in "$1" "$2"; do',
        '    if test "$name" = skip; then',
        "      continue",
        "    fi",
        '    greet "$name"',
        "  done",
        "else",
        "  echo missing",
        "fi",
      ].join("\n"),
    );

    expect(shell.submit("bash /advanced.sh Ada skip").lines).toEqual([
      "hello Ada",
    ]);
    expect(shell.submit("bash /advanced.sh Ada").lines).toEqual(["missing"]);
  });

  it("reports sandbox identity, deterministic time, history, and filesystem information", (): void => {
    let tick = 40;
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, {
      clock: {
        currentGameTime: (): {
          readonly absoluteTicks: number;
          readonly timeOfDay: number;
        } => ({ absoluteTicks: 48_000, timeOfDay: 1_000 }),
        currentWallTimeMilliseconds: (): number =>
          Date.UTC(2026, 6, 14, 0, 50, 30),
      },
      computerId: 7,
      computerName: "c-info01",
      currentTick: (): number => tick,
      hardware: {
        clockHz: 10_000,
        cpuModel: "cs486dx",
        memoryBytes: 2_097_152,
      },
      memoryUsageBytes: (): number => 65_536,
      ticksPerSecond: 20,
    });

    expect(shell.submit("whoami").lines).toEqual(["computer"]);
    expect(shell.submit("id").lines[0]).toContain("uid=0(computer)");
    expect(shell.submit("hostname").lines).toEqual(["c-info01"]);
    expect(shell.submit("uname -a").lines[0]).toBe(
      "Computer System Linux 1.0 c-info01 sandbox-vm",
    );
    expect(shell.submit("echo $OS").lines).toEqual(["CS-Linux"]);
    expect(shell.submit("date +%Y-%m-%dT%H:%M:%S").lines).toEqual([
      "2026-07-14T00:50:30",
    ]);
    expect(shell.submit("date --game").lines).toEqual([
      "Minecraft day 3 07:00:00",
    ]);
    expect(shell.submit("date --virtual +%Y-%m-%dT%H:%M:%S").lines).toEqual([
      "2000-01-01T00:00:02",
    ]);
    tick = 60;
    expect(shell.submit("uptime").lines).toEqual(["1.00 seconds"]);
    expect(shell.submit("stat /etc/os-release").lines[0]).toMatch(/^file /u);
    expect(shell.submit("cat /etc/os-release").lines).toContain(
      'PRETTY_NAME="Computer System Linux 1.0"',
    );
    expect(shell.submit("df").lines[0]).toContain("Filesystem");
    expect(shell.submit("du -s /etc").lines[0]).toMatch(/^\d+\t\/etc$/u);
    expect(shell.submit("quota").lines).toEqual([
      expect.stringMatching(/^Disk quota: \d+ \/ 1000000 bytes used/u),
      "Limits: 256000 bytes/file, 4096 entries",
    ]);
    expect(shell.submit("cpuinfo").lines).toContain("clock\t\t: 10 kHz");
    expect(shell.submit("free -h").lines[1]).toContain("2.0 MiB");
    expect(shell.submit("cat /proc/cpuinfo").lines).toContain(
      "model name\t: Computer System 486DX",
    );
    expect(shell.submit("cat /proc/meminfo").lines).toContain(
      "MemUsed:  65536 B",
    );
    expect(shell.submit("ls /proc").lines[0]).toContain("cpuinfo");
    expect(shell.submit("CPU").exitCode).toBe(127);
    expect(
      shell.submit("history").lines.some((line) => line.includes("whoami")),
    ).toBe(true);
    expect(shell.submit("time echo measured").stderr).toBe("real 0.000s\n");
  });

  it("implements bounded test, sleep, seq, and cut applets", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem(), {
      ticksPerSecond: 20,
    });

    expect(shell.submit("test -d /etc").exitCode).toBe(0);
    expect(shell.submit("[ 4 -gt 3 ]").exitCode).toBe(0);
    expect(shell.submit("[ -f /missing ]").exitCode).toBe(1);
    expect(shell.submit("sleep 0.25").sleepTicks).toBe(5);
    expect(shell.submit("sleep 99999").exitCode).toBe(2);
    expect(shell.submit("seq 2 2 6").lines).toEqual(["2", "4", "6"]);
    expect(shell.submit("printf 'a:b:c\n' | cut -d : -f 1,3").lines).toEqual([
      "a:c",
    ]);
  });

  it("reports bounded CPU work for shell scripts including silent loops", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile(
      "/work.sh",
      ["for item in 1 2 3; do", "  true", "done"].join("\n"),
    );

    const simple = shell.submit("true").cpuCycles ?? 0;
    const scripted = shell.submit("bash /work.sh").cpuCycles ?? 0;

    expect(simple).toBeGreaterThan(0);
    expect(scripted).toBeGreaterThan(simple);
    expect(scripted).toBeLessThanOrEqual(1_000_000);
  });
});
