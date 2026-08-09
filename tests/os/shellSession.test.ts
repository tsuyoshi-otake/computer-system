import { describe, expect, it } from "vitest";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { portableComputerHardware } from "../../src/domain/computer/hardware.js";

describe("Computer System Linux shell and editor", (): void => {
  it("lists and reads files and reports unknown commands", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.writeFile("/hello.py", "print('hi')");
    const shell = new ShellSession(filesystem);
    expect(shell.prompt()).toBe("cs@c-000000:~$ ");
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
      'import redstone\r\nprint("ready")',
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

  it("prepares Python as one direct CS-Linux foreground process", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { deferGuestExecution: true });
    filesystem.writeFile("/tmp/demo.py", "print(42)\n");

    expect(shell.submit("python --stats /tmp/demo.py")).toMatchObject({
      exitCode: 0,
      foreground: {
        command: "python",
        kind: "python",
        path: "/tmp/demo.py",
        stats: true,
      },
    });
    expect(shell.submit("micropython /tmp/demo.py")).toMatchObject({
      exitCode: 0,
      foreground: {
        command: "micropython",
        stats: false,
      },
    });
    expect(shell.submit("python")).toMatchObject({
      exitCode: 0,
      foreground: {
        command: "python",
        kind: "python-repl",
        path: "/home/cs/__repl__.py",
      },
    });
    expect(shell.submit("python > /tmp/repl.txt")).toMatchObject({
      exitCode: 2,
      stderr: "python: interactive REPL does not support redirection\n",
    });
    expect(shell.submit("python /tmp/demo.py | cat")).toMatchObject({
      exitCode: 0,
      foreground: { command: "pipeline", kind: "pipeline" },
    });
    expect(shell.submit("python /tmp/demo.py > /tmp/output.txt")).toMatchObject(
      {
        exitCode: 0,
        foreground: { command: "python", kind: "python" },
      },
    );

    const unsupported = new ShellSession(filesystem, {
      hardware: portableComputerHardware,
    });
    expect(unsupported.submit("python /tmp/demo.py")).toMatchObject({
      exitCode: 127,
      stderr: "python: MicroPython is not available on CS386SX\n",
    });
    expect(unsupported.submit("python")).toMatchObject({
      exitCode: 127,
      stderr: "python: MicroPython is not available on CS386SX\n",
    });
    const dos = new ShellSession(filesystem, {
      hardware: portableComputerHardware,
      osProfile: "dos",
    });
    expect(dos.submit("PYTHON C:\\TEMP\\DEMO.PY")).toMatchObject({
      exitCode: 127,
    });
  });

  it("executes bare Perl source from pipes and input redirects", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile("/tmp/program.pl", 'print "redirect\\n";\n');
    filesystem.writeFile("/tmp/empty.pl", "");

    expect(shell.submit("perl < /tmp/program.pl")).toMatchObject({
      exitCode: 0,
      stdout: "redirect\n",
    });
    expect(shell.submit("perl < /tmp/empty.pl")).toMatchObject({
      exitCode: 0,
      stdout: "",
    });
    expect(shell.submit(`printf 'print "pipe\\n";\\n' | perl`)).toMatchObject({
      exitCode: 0,
      stdout: "pipe\n",
    });
    expect(
      shell.submit(
        `printf 'while (<STDIN>) { print "replayed\\n"; }\\n' | perl`,
      ),
    ).toMatchObject({ exitCode: 0, stdout: "" });
  });

  it("collects bounded terminal Perl source until EOF without shell history", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    expect(shell.submit("perl")).toMatchObject({ exitCode: 0, lines: [] });
    expect(shell.prompt()).toBe("");
    expect(shell.terminalInteraction()).toMatchObject({
      context: "perl-source",
      ctrlCAction: "cancel",
      eof: true,
      history: false,
      inputMode: "line",
    });
    expect(shell.submit('print "tty\\n";')).toMatchObject({
      exitCode: 0,
      lines: [],
    });
    expect(shell.eof()).toMatchObject({ exitCode: 0, stdout: "tty\n" });
    expect(shell.prompt()).toBe("cs@c-000000:~$ ");
    expect(shell.submit("history").stdout).not.toContain('print "tty\\n";');

    expect(shell.submit("perl")).toMatchObject({ exitCode: 0 });
    expect(shell.eof()).toMatchObject({ exitCode: 0, stdout: "" });

    expect(shell.submit("perl > /tmp/perl-output.txt").exitCode).toBe(0);
    shell.submit('print "written\\n";');
    expect(shell.eof()).toMatchObject({ exitCode: 0, stdout: "" });
    expect(filesystem.readFile("/tmp/perl-output.txt")).toBe("written\n");
  });

  it("finalizes terminal Perl cancellation, limits, disconnect, and MCP paths", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    shell.submit("perl");
    shell.submit('open my $fh, ">", "/tmp/mutated"; print $fh "bad";');
    expect(shell.cancelTerminalInteraction()).toBe(true);
    expect(shell.submit("echo $?").stdout).toBe("130\n");
    expect(filesystem.exists("/tmp/mutated")).toBe(false);
    expect(shell.terminalInteraction().context).toBe("shell");
    expect(shell.submit("echo recovered").stdout).toBe("recovered\n");

    shell.submit("perl");
    expect(shell.submit("x".repeat(65_535))).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(shell.cancelTerminalInteraction()).toBe(true);

    shell.submit("perl");
    expect(shell.submit("x".repeat(65_536))).toMatchObject({
      exitCode: 2,
      stderr: "perl: program byte limit exceeded\n",
    });
    expect(shell.terminalInteraction().context).toBe("shell");

    shell.submit("perl");
    for (let line = 0; line < 4_096; line += 1)
      expect(shell.submit("").exitCode).toBe(0);
    expect(shell.submit("")).toMatchObject({
      exitCode: 2,
      stderr: "perl: program line limit exceeded\n",
    });
    expect(shell.eof()).toMatchObject({
      exitCode: 2,
      stderr: "shell: EOF is unavailable in the current input context\n",
    });

    shell.submit("perl");
    shell.submit('print "must not run\\n";');
    shell.disconnect();
    expect(filesystem.exists("/tmp/mutated")).toBe(false);
    expect(shell.submitDebugCommand("perl")).toMatchObject({
      exitCode: 2,
      stderr:
        "debug: interactive Perl source collection is not supported through MCP\n",
    });
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
    expect(shell.prompt()).toBe("cs@c-000000:~$ ");
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
    expect(shell.submit("pwd").lines).toEqual(["/home/cs/work"]);
    expect(shell.submit("touch data/empty").exitCode).toBe(0);
    expect(shell.submit("echo hello > data/message").lines).toEqual([]);
    expect(shell.submit("echo world >> data/message").exitCode).toBe(0);
    expect(shell.submit("cp data/message data/copy").exitCode).toBe(0);
    expect(shell.submit("mv data/copy data/moved").exitCode).toBe(0);
    const listing = shell.submit("ls -la data").lines;
    expect(listing[0]).toBe("total 24");
    expect(listing.some((line) => /^drwxr-xr-x .* \.$/u.test(line))).toBe(true);
    expect(listing.some((line) => /^-rw-r--r-- .* empty$/u.test(line))).toBe(
      true,
    );
    expect(listing.some((line) => /^-rw-r--r-- .* message$/u.test(line))).toBe(
      true,
    );
    expect(listing.some((line) => /^-rw-r--r-- .* moved$/u.test(line))).toBe(
      true,
    );
    expect(shell.submit("rm data/moved").exitCode).toBe(0);
    expect(shell.submit("find . -name 'm*'").lines).toEqual([
      "/home/cs/work/data/message",
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
    expect(shell.submit("yes | head -n 3 && echo done").lines).toEqual([
      "y",
      "y",
      "y",
      "done",
    ]);
  });

  it("preserves multi-stage pipeline data, stderr separation, and final-stage status", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    const counted = shell.submit(
      "printf 'warn: one\ninfo: two\nWARN: three\n' | grep -i warn | tee /tmp/warnings.log | wc -l",
    );
    expect(counted.exitCode).toBe(0);
    expect(counted.stdout).toBe("      2\n");
    expect(counted.stderr).toBe("");
    expect(filesystem.readFile("/tmp/warnings.log")).toBe(
      "warn: one\nWARN: three\n",
    );

    const failedFinalStage = shell.submit(
      "printf 'ready\n' | grep missing && echo should-not-run",
    );
    expect(failedFinalStage).toMatchObject({
      exitCode: 1,
      stderr: "",
      stdout: "",
    });

    const separatedError = shell.submit("cat /tmp/absent | wc -l");
    expect(separatedError).toMatchObject({ exitCode: 0, stdout: "      0\n" });
    expect(separatedError.stderr).toContain("/tmp/absent");

    const pipedError = shell.submit("cat /tmp/absent 2>&1 | grep /tmp/absent");
    expect(pipedError).toMatchObject({ exitCode: 0, stderr: "" });
    expect(pipedError.stdout).toContain("/tmp/absent");
  });

  it("applies Linux descriptor redirects in source order before execution", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    expect(shell.submit("time echo out > /tmp/all 2>&1").lines).toEqual([]);
    expect(filesystem.readFile("/tmp/all")).toBe("out\nreal 0.000s\n");

    expect(shell.submit("time echo out &> /tmp/combined").lines).toEqual([]);
    expect(filesystem.readFile("/tmp/combined")).toBe("out\nreal 0.000s\n");

    expect(shell.submit("time echo out 2>&1 > /tmp/out").lines).toEqual([
      "real 0.000s",
    ]);
    expect(filesystem.readFile("/tmp/out")).toBe("out\n");

    expect(shell.submit("time echo out 2> /tmp/err | cat").lines).toEqual([
      "out",
    ]);
    expect(filesystem.readFile("/tmp/err")).toBe("real 0.000s\n");

    expect(shell.submit("time echo out 2> /tmp/err |& cat").lines).toEqual([
      "out",
      "real 0.000s",
    ]);
    expect(filesystem.readFile("/tmp/err")).toBe("");
  });

  it("feeds literal here-documents to Linux commands and scripts", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    expect(shell.submit("cat <<EOF\none\ntwo\nEOF").lines).toEqual([
      "one",
      "two",
    ]);
    expect(shell.submit("cat <<EOF | grep two\none\ntwo\nEOF").lines).toEqual([
      "two",
    ]);

    filesystem.writeFile(
      "/tmp/here.sh",
      "cat <<EOF\nfrom script\nEOF\necho after\n",
    );
    expect(shell.submit("sh /tmp/here.sh").lines).toEqual([
      "from script",
      "after",
    ]);
    expect(shell.submit("cat <<EOF\nmissing")).toMatchObject({
      exitCode: 2,
      stderr:
        "bash: syntax error: here-document 'EOF' is missing its terminating delimiter\n",
    });

    const dos = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });
    expect(dos.submit("TYPE <<EOF\nignored\nEOF")).toMatchObject({
      exitCode: 2,
    });
  });

  it("opens redirects before command reads and rejects Linux fd syntax on DOS", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile("/tmp/same", "before\n");
    expect(shell.submit("cat /tmp/same > /tmp/same").exitCode).toBe(0);
    expect(filesystem.readFile("/tmp/same")).toBe("");
    filesystem.writeFile("/tmp/same", "before\n");
    expect(shell.submit("cat < /tmp/same > /tmp/same").exitCode).toBe(0);
    expect(filesystem.readFile("/tmp/same")).toBe("");

    filesystem.writeFile("/tmp/input", "from file\n");
    expect(shell.submit("yes | cat < /tmp/input").lines).toEqual(["from file"]);
    expect(shell.submit("echo hidden > /tmp/out | cat").lines).toEqual([]);
    expect(filesystem.readFile("/tmp/out")).toBe("hidden\n");

    const dos = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });
    expect(dos.submit("ECHO ok 2>C:\\SIDE.TXT")).toMatchObject({ exitCode: 2 });
    expect(dos.submit("ECHO ok &>C:\\BOTH.TXT")).toMatchObject({ exitCode: 2 });
    expect(dos.submit("DIR |& MORE")).toMatchObject({ exitCode: 2 });
    expect(dos.submit("IF EXIST C:\\SIDE.TXT ECHO bad").stdout).toBe("");
  });

  it("completes commands and filesystem paths at the cursor", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());
    expect(shell.complete("who", 3)).toEqual({
      candidates: [
        { displayText: "who", insertText: "who ", kind: "command" },
        { displayText: "whoami", insertText: "whoami ", kind: "command" },
      ],
      cursor: 3,
      replaceEnd: 3,
      replaceStart: 0,
      truncated: false,
      value: "who",
    });
    expect(shell.complete("cat /et", 7)).toEqual({
      candidates: [
        { displayText: "/etc/", insertText: "/etc/", kind: "directory" },
      ],
      cursor: 9,
      replaceEnd: 7,
      replaceStart: 4,
      truncated: false,
      value: "cat /etc/",
    });
    expect(shell.complete("s", 1).candidates.length).toBeGreaterThan(1);

    expect(shell.completeTerminal("who", 3)).toEqual({
      lines: ["who     whoami"],
      response: {
        cursor: 3,
        outcome: "listed",
        truncated: false,
        value: "who",
      },
    });
    expect(shell.completeTerminal("cat /et", 7)).toEqual({
      lines: [],
      response: {
        cursor: 9,
        outcome: "applied",
        truncated: false,
        value: "cat /etc/",
      },
    });

    const bounded = shell.completeTerminal("", 0);
    expect(bounded.response).toMatchObject({
      cursor: 0,
      outcome: "listed",
      truncated: true,
      value: "",
    });
    expect(bounded.lines.at(-1)).toBe("...");
    expect(bounded.lines.length).toBeLessThanOrEqual(65);
    expect(bounded.lines.every((line) => [...line].length <= 80)).toBe(true);
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
    expect(filesystem.readFile("/home/cs/.bashrc")).toBe(
      "export FAVORITE=doraemon\n",
    );
    expect(filesystem.exists("/home/computer")).toBe(false);
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
      ticksPerSecond: 20,
    });

    expect(shell.submit("whoami").lines).toEqual(["cs"]);
    expect(shell.submit("id").lines[0]).toContain("uid=1000(cs)");
    expect(shell.submit("hostname").lines).toEqual(["c-info01"]);
    expect(shell.submit("uname -a").lines[0]).toBe(
      "Linux c-info01 1.0.0-cs #1 CS-Linux SMP i486 GNU/Linux",
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
    expect(shell.submit("uptime").lines[0]).toContain(
      "up 00:00,  1 user,  load average: 0.00, 0.00, 0.00",
    );
    expect(shell.submit("stat /etc/os-release").lines[0]).toBe(
      "  File: /etc/os-release",
    );
    expect(shell.submit("cat /etc/os-release").lines).toContain(
      'PRETTY_NAME="Computer System Linux 1.0"',
    );
    expect(shell.submit("df").lines[0]).toContain("Filesystem");
    expect(shell.submit("du -s /etc").lines[0]).toMatch(/^\d+\t\/etc$/u);
    expect(shell.submit("quota").lines).toEqual([
      expect.stringMatching(/^Disk quota: \d+ \/ 41943040 bytes used/u),
      "Limits: 8388608 bytes/file, 4096 entries",
    ]);
    expect(shell.submit("cpuinfo").lines).toContain("clock\t\t: 10 kHz");
    expect(shell.submit("free -h").lines[1]).toContain("2.0 MiB");
    expect(shell.submit("cat /proc/cpuinfo").lines).toContain(
      "model name\t: Computer System 486DX",
    );
    const meminfo = shell.submit("cat /proc/meminfo").lines;
    expect(meminfo).toContain("MemUsed:  786432 B");
    expect(meminfo).toContain("MemFree:  1310720 B");
    expect(meminfo).toContain("MemAvailable: 1376256 B");
    expect(meminfo).toContain("KernelResident: 524288 B");
    expect(meminfo).toContain("Buffers: 65536 B");
    expect(meminfo).toContain("GuestRuntime: 0 B");
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
