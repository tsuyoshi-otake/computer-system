import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { getOsProfile } from "../../src/application/os/osProfile.js";
import { portableComputerHardware } from "../../src/domain/computer/hardware.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("DOS profile contract", (): void => {
  it("stores external commands as deletable DOS files", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });

    expect(filesystem.getSize("/drives/c/dos/edit.com")).toBe(69_886);
    expect(shell.submit("DEL C:\\DOS\\EDIT.COM").exitCode).toBe(0);
    expect(shell.submit("EDIT README.TXT")).toMatchObject({ exitCode: 127 });
    expect(filesystem.snapshot().tombstones).toContain(
      "/drives/c/dos/edit.com",
    );
  });

  it("fails boot explicitly when COMMAND.COM is missing", (): void => {
    const filesystem = new InMemoryFilesystem();
    new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.delete("/drives/c/command.com");

    expect(() => new ShellSession(filesystem, { osProfile: "dos" })).toThrow(
      "Bad or missing Command Interpreter",
    );
  });

  it("advertises DOS line editing and enables history only after bare DOSKEY", (): void => {
    const historyOnly = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });
    expect(historyOnly.terminalInteraction()).toMatchObject({
      cursorShape: "underline",
      history: false,
      inputMode: "line",
    });
    historyOnly.submit("DOSKEY /HISTORY");
    expect(historyOnly.terminalInteraction().history).toBe(false);

    const loaded = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });
    expect(loaded.submit("DOSKEY").stdout).toContain("DOSKey installed");
    expect(loaded.terminalInteraction()).toMatchObject({
      cursorShape: "underline",
      history: true,
      inputMode: "line",
    });
  });

  it("uses DOS command names, CRLF output, and bounded compatibility utilities", (): void => {
    let tick = 20;
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, {
      clock: {
        currentGameTime: (): { absoluteTicks: number; timeOfDay: number } => ({
          absoluteTicks: 0,
          timeOfDay: 0,
        }),
        currentWallTimeMilliseconds: (): number =>
          Date.UTC(2026, 6, 14, 12, 34, 56, 780),
      },
      computerId: 0x1234,
      currentTick: (): number => tick,
      osProfile: "dos",
      ticksPerSecond: 20,
    });

    expect(shell.submit("TIME").stdout).toBe("Current time is 12:34:56.78\r\n");
    expect(shell.submit("TIME 10:00").stderr).toBe(
      "The host-backed system time cannot be changed.\r\n",
    );
    tick += 2;
    expect(shell.submit("TIMER ECHO measured").stderr).toBe(
      "Elapsed time: 0.000 seconds\r\n",
    );
    expect(shell.submit("VER").stdout).toBe(
      "Computer System DOS Version 1.00\r\n",
    );
    const help = shell.submit("HELP");
    expect(help.lines).toContain("Computer System DOS 1.0 Command Help");
    expect(help.stdout).toContain("CS ASM 1.0");
    expect(help.stdout).toContain("CS C/C++ 1.0");
    expect(help.stdout).toContain("CS QBASIC 1.0");
    expect(shell.submit("HELP EDIT").stdout).toContain(
      "bounded A:/C: DOS file browser",
    );
    expect(shell.submit("HELP PWB").stdout).toContain("CS PROGRAM LIST 1.0");
    expect(shell.submit("HELP CSCPP").stdout).toContain('extern "C"');
    expect(shell.submit("HELP QBASIC").stdout).toContain(
      "does not create OBJ, CSX, EXE",
    );
    expect(shell.submit("VOL").stdout).toContain(
      "Volume Serial Number is 0000-1234\r\n",
    );

    expect(shell.submit("MD C:\\WORK").exitCode).toBe(0);
    expect(shell.submit("CHDIR C:\\WORK").exitCode).toBe(0);
    expect(shell.submit("CD").stdout).toBe("C:\\WORK\r\n");
    shell.submit("ECHO VALUE > ONE.TXT");
    expect(shell.submit("COPY ONE.TXT TWO.TXT").stdout).toBe(
      "        1 file(s) copied.\r\n",
    );
    expect(shell.submit("TYPE TWO.TXT").stdout).toBe("VALUE\r\n");
    expect(shell.submit("RENAME TWO.TXT RENAMED.TXT").exitCode).toBe(0);
    expect(shell.submit("DIR /B").stdout).toBe("ONE.TXT\r\nRENAMED.TXT\r\n");
    const detailed = shell.submit("DIR").stdout;
    expect(detailed).toContain("Volume in drive C is CS-DOS\r\n");
    expect(detailed).toContain("Directory of C:\\WORK\r\n");
    expect(detailed).toContain("2 file(s)");
    expect(detailed).not.toMatch(/(?<!\r)\n/u);
    expect(shell.submit("TREE C:\\ /F").stdout).toContain("+---WORK");
    expect(shell.submit("MEM /F").stdout).toContain("Free memory blocks:");
    expect(shell.submit("DOSKEY /HISTORY").stdout).toContain(
      "COPY ONE.TXT TWO.TXT\r\n",
    );
    expect(shell.submit("ERASE RENAMED.TXT").exitCode).toBe(0);
    expect(shell.submit("DEL ONE.TXT").exitCode).toBe(0);
    expect(shell.submit("CHDIR C:\\").exitCode).toBe(0);
    expect(shell.submit("RMDIR C:\\WORK").exitCode).toBe(0);
  });

  it("renders aligned MS-DOS-style 8.3 DIR rows and comma-separated sizes", (): void => {
    const writtenAt = Date.UTC(2026, 6, 18, 9, 36);
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, {
      clock: {
        currentGameTime: (): { absoluteTicks: number; timeOfDay: number } => ({
          absoluteTicks: 0,
          timeOfDay: 0,
        }),
        currentWallTimeMilliseconds: (): number => writtenAt,
      },
      osProfile: "dos",
    });

    expect(shell.submit("MD C:\\VIEW").exitCode).toBe(0);
    filesystem.makeDirectory("/drives/c/view/dos");
    filesystem.setModifiedTime("/drives/c/view/dos", writtenAt);
    filesystem.writeFile("/drives/c/view/bigfile.txt", "X".repeat(54_645));
    filesystem.setModifiedTime(
      "/drives/c/view/bigfile.txt",
      Date.UTC(1994, 4, 31, 6, 22),
    );

    const output = shell.submit("DIR C:\\VIEW").stdout;

    expect(output).toContain("BIGFILE  TXT        54,645 05-31-94   6:22a\r\n");
    expect(output).toContain("DOS          <DIR>         07-18-26   9:36a\r\n");
    expect(output).toContain("        1 file(s)         54,645 bytes\r\n");
    expect(output).toMatch(
      /\r\n {8}1 dir\(s\)\s+\d{1,3}(?:,\d{3})+ bytes free\r\n/u,
    );
  });

  it("supports drive paths, case-insensitive lookup, CRLF boot files, and NUL", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, {
      computerName: "c-dos002",
      osProfile: "dos",
    });

    expect(shell.submit("CD C:\\DOS").exitCode).toBe(0);
    expect(shell.submit("CD").lines).toEqual(["C:\\DOS"]);
    expect(shell.submit("ECHO VALUE > C:\\Mixed.TXT").exitCode).toBe(0);
    expect(shell.submit("TYPE c:\\mixed.txt").lines).toEqual(["VALUE"]);
    expect(filesystem.readFile("/drives/c/autoexec.bat")).toContain("\r\n");
    expect(shell.submit("ECHO ignored > NUL").exitCode).toBe(0);
    expect(filesystem.exists("/drives/c/nul")).toBe(false);
  });

  it("enforces DOS 8.3 names without silently truncating them", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });

    expect(shell.submit("ECHO VALUE > C:\\README.TXT").exitCode).toBe(0);
    expect(shell.submit("TYPE C:\\README.TXT").stdout).toBe("VALUE\r\n");

    const longBase = shell.submit("ECHO BAD > C:\\TOOLONGNM.TXT");
    expect(longBase).toMatchObject({
      exitCode: 1,
      stderr: "Invalid filename or extension.\r\n",
    });
    const longExtension = shell.submit("TYPE C:\\README.TEXT");
    expect(longExtension).toMatchObject({
      exitCode: 1,
      stderr: "Invalid filename or extension.\r\n",
    });
    expect(filesystem.exists("/drives/c/toolongnm.txt")).toBe(false);
  });

  it("persists the selected profile independently of Linux defaults", (): void => {
    const filesystem = new InMemoryFilesystem();
    new ShellSession(filesystem, { osProfile: "dos" });

    expect(filesystem.exists("/drives/c/config.sys")).toBe(true);
    expect(filesystem.exists("/etc/os-release")).toBe(false);
  });

  it("reports shared virtual hardware with DOS commands and no proc filesystem", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem(), {
      computerName: "c-dos002",
      hardware: portableComputerHardware,
      osProfile: "dos",
      ticksPerSecond: 20,
    });

    expect(shell.submit("CPU").lines).toContain("Computer System 386SX");
    expect(shell.submit("CPU").lines).toContain("Model ID: cs386sx");
    expect(shell.submit("CPU").lines).toContain("Data bus: 16 bit");
    expect(shell.submit("CPU").lines).toContain("Clock speed: 16 MHz");
    expect(shell.submit("MEM").lines).toContain(
      "     2097152 bytes total memory",
    );
    expect(shell.submit("MEM /C").lines).toContain(
      "           0 bytes guest runtime",
    );
    expect(shell.submit("MEM /C").lines).toContain(
      "      113152 bytes DOS system and drivers",
    );
    expect(shell.submit("MEM /C").stdout).toContain("os/command");
    expect(shell.submit("MEM /C").stdout).toContain(
      "COMMAND.COM               32768  Conventional",
    );
    expect(shell.submit("MEM /C").stdout).toContain("driver/himem");
    expect(shell.submit("MEM /C").stdout).toContain("driver/emm386");
    expect(shell.submit("MEM /D").lines).toContain(
      "CPU mode: protected sandbox",
    );
    expect(shell.submit("MEM /D").lines).toContain(
      "XMS driver (HIMEM.SYS): installed",
    );
    expect(shell.submit("MEM /D").lines).toContain("UMB link: enabled");
    expect(shell.submit("MEM /P").exitCode).toBe(2);
    expect(shell.submit("SYSTEMINFO").lines).toContain("Computer ID: c-dos002");
    expect(shell.submit("VER").lines[0]).toBe(
      "Computer System DOS Version 1.00",
    );
    expect(shell.submit("ECHO %OS%").lines).toEqual(["ECHO is off."]);
    expect(shell.submit("SYSTEMINFO").lines).toContain("OS Alias: CS-DOS 1.0");
    expect(shell.submit("SYSTEMINFO").stdout).toContain(
      "CPU: Computer System 386SX, 16 MHz",
    );
    expect(shell.submit("CPUINFO").exitCode).toBe(127);
    expect(shell.submit("TYPE C:\\PROC\\CPUINFO").exitCode).toBe(1);
  });

  it("preserves four-digit years across Y2K, leap-day, and post-2038 dates", (): void => {
    let wallTime = Date.UTC(2000, 1, 29, 23, 59, 59);
    const clock = {
      currentGameTime: (): { absoluteTicks: number; timeOfDay: number } => ({
        absoluteTicks: 0,
        timeOfDay: 0,
      }),
      currentWallTimeMilliseconds: (): number => wallTime,
    };
    const linux = new ShellSession(new InMemoryFilesystem(), { clock });
    const dos = new ShellSession(new InMemoryFilesystem(), {
      clock,
      osProfile: "dos",
    });

    expect(linux.submit("date +%Y-%m-%dT%H:%M:%S").lines).toEqual([
      "2000-02-29T23:59:59",
    ]);
    expect(dos.submit("DATE").lines).toEqual([
      "Current date is Tue 02-29-2000",
    ]);

    wallTime = Date.UTC(2040, 0, 1);
    expect(Number(linux.submit("date +%s").lines[0])).toBeGreaterThan(
      2_147_483_647,
    );
    expect(dos.submit("DATE").lines).toEqual([
      "Current date is Sun 01-01-2040",
    ]);
  });

  it("runs CS486-format programs with CS386SX timing at 16 MHz", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, {
      hardware: portableComputerHardware,
      osProfile: "dos",
    });
    filesystem.writeFile(
      "/drives/c/answer.asm",
      "mov eax, 6\nmul eax, 7\nprint eax\nhalt\n",
    );

    expect(shell.submit("as C:\\answer.asm -o C:\\answer").exitCode).toBe(0);
    expect(shell.submit("C:\\answer").stdout).toBe("42");
    expect(shell.submit("run --stats C:\\answer").stderr).toMatch(
      /^CS386SX: 4 instructions, 29 CPU cycles, 1\.813 us at 16 MHz, halted/u,
    );

    filesystem.writeFile(
      "/drives/c/answer.cpp",
      [
        "int main() {",
        "int answer = 6 * 7;",
        "std::cout << answer << std::endl;",
        "return 0;",
        "}",
      ].join("\n"),
    );
    expect(shell.submit("C++ C:\\answer.cpp -O C:\\anscpp").exitCode).toBe(0);
    expect(shell.submit("C:\\anscpp").stdout).toBe("42\r\n");
    expect(shell.submit("RUN --STATS C:\\anscpp").stderr).toContain("CS386SX");
  });

  it("loads bounded CONFIG.SYS and AUTOEXEC.BAT DOS essentials", (): void => {
    const filesystem = new InMemoryFilesystem();
    const profile = getOsProfile("dos");
    profile.boot(filesystem, { computerName: "c-dos003" });
    filesystem.writeFile(
      "/drives/c/config.sys",
      [
        "DEVICE=C:\\DOS\\HIMEM.SYS",
        "DEVICE=C:\\DOS\\EMM386.EXE NOEMS",
        "DOS=HIGH,UMB",
        "FILES=40",
        "BUFFERS=20",
        "",
      ].join("\r\n"),
    );
    filesystem.writeFile(
      "/drives/c/autoexec.bat",
      [
        "@ECHO OFF",
        "SET MODE=PORTABLE",
        "PATH C:\\TOOLS;C:\\DOS",
        "PROMPT [$N]$P$G",
        "REM bounded startup",
        "",
      ].join("\r\n"),
    );

    const shell = new ShellSession(filesystem, {
      hardware: portableComputerHardware,
      osProfile: "dos",
    });

    expect(shell.takeStartupLines()).toEqual([]);
    expect(shell.submit("SET MODE").lines).toEqual(["MODE=PORTABLE"]);
    expect(shell.submit("SET CONFIG_FILES").lines).toEqual([
      "Environment variable CONFIG_FILES not defined",
    ]);
    expect(shell.submit("MEM").lines).toContain(
      "      115776 bytes DOS system and drivers",
    );
    expect(shell.submit("PATH").lines).toEqual(["PATH=C:\\TOOLS;C:\\DOS"]);
    expect(shell.prompt()).toBe("[C]C:\\> ");
  });

  it("runs CRLF batch files from PATH with arguments and ERRORLEVEL", (): void => {
    const filesystem = new InMemoryFilesystem();
    const profile = getOsProfile("dos");
    profile.boot(filesystem, { computerName: "c-dos004" });
    filesystem.makeDirectory("/drives/c/tools");
    filesystem.writeFile(
      "/drives/c/autoexec.bat",
      "@ECHO OFF\r\nPATH C:\\TOOLS;C:\\DOS\r\n",
    );
    filesystem.writeFile(
      "/drives/c/tools/hello.bat",
      [
        "@ECHO OFF",
        "ECHO %0",
        "ECHO %1",
        "TYPE C:\\MISSING.TXT",
        "ECHO %ERRORLEVEL%",
        "SET RESULT=%2",
        "",
      ].join("\r\n"),
    );
    const shell = new ShellSession(filesystem, { osProfile: "dos" });

    const result = shell.submit("HELLO alpha beta");
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([
      "File not found.",
      "C:\\TOOLS\\HELLO.BAT",
      "alpha",
      "1",
    ]);
    expect(shell.submit("SET RESULT").lines).toEqual(["RESULT=beta"]);
  });

  it("rejects Unix command-chain syntax inside BAT before side effects", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile(
      "/drives/c/chain.bat",
      "@ECHO OFF\r\nECHO FIRST && ECHO SECOND\r\nECHO NEVER > C:\\LEAK.TXT\r\n",
    );

    const result = shell.submit("CHAIN");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain("Unix && and || command chains");
    expect(filesystem.exists("/drives/c/leak.txt")).toBe(false);
  });

  it("reports unsupported CONFIG.SYS directives instead of ignoring them", (): void => {
    const filesystem = new InMemoryFilesystem();
    const profile = getOsProfile("dos");
    profile.boot(filesystem, { computerName: "c-dos005" });
    filesystem.writeFile(
      "/drives/c/config.sys",
      "DEVICE=C:\\DOS\\UNKNOWN.SYS\r\nSHELL=C:\\4DOS.COM\r\n",
    );

    const shell = new ShellSession(filesystem, { osProfile: "dos" });

    expect(shell.takeStartupLines()).toEqual([
      "CONFIG.SYS line 1: C:\\DOS\\UNKNOWN.SYS is unsupported",
      "CONFIG.SYS line 2: Unsupported CONFIG.SYS directive: SHELL=C:\\4DOS.COM",
      "CONFIG.SYS: Invalid CONFIG.SYS; booted the explicit 64 KiB low-memory DOS profile",
    ]);
  });

  it("loads CONFIG.SYS memory drivers only from intact installed capsules", (): void => {
    const filesystem = new InMemoryFilesystem();
    const profile = getOsProfile("dos");
    profile.boot(filesystem, { computerName: "c-dos007" });
    filesystem.writeFile("/drives/c/dos/himem.sys", "tampered driver\n");
    filesystem.delete("/drives/c/dos/emm386.exe");

    const shell = new ShellSession(filesystem, { osProfile: "dos" });

    expect(shell.takeStartupLines()).toEqual([
      "CONFIG.SYS line 1: C:\\DOS\\HIMEM.SYS is invalid",
      "CONFIG.SYS line 2: EMM386.EXE NOEMS requires HIMEM.SYS to be loaded first",
      "CONFIG.SYS line 3: DOS=HIGH,UMB requires HIMEM.SYS and EMM386.EXE NOEMS to be loaded first",
      "CONFIG.SYS: Invalid CONFIG.SYS; booted the explicit 64 KiB low-memory DOS profile",
    ]);
    expect(shell.submit("MEM /D").lines).toContain(
      "XMS driver (HIMEM.SYS): not installed",
    );
    expect(shell.submit("MEM /D").lines).toContain(
      "UMB provider (EMM386.EXE): not installed",
    );
  });

  it("terminates oversized and recursively nested batch work explicitly", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile(
      "/drives/c/large.bat",
      Array.from({ length: 257 }, () => "REM bounded").join("\r\n"),
    );
    filesystem.writeFile("/drives/c/loop.bat", "@ECHO OFF\r\nLOOP\r\n");

    expect(shell.submit("LARGE")).toMatchObject({ exitCode: 1 });
    expect(shell.submit("LARGE").stderr).toContain("batch line limit exceeded");
    expect(shell.submit("LOOP")).toMatchObject({ exitCode: 1 });
    expect(shell.submit("LOOP").stderr).toContain(
      "maximum batch depth exceeded",
    );
  });

  it("terminates oversized CONFIG.SYS before AUTOEXEC becomes implicit success", (): void => {
    const filesystem = new InMemoryFilesystem();
    const profile = getOsProfile("dos");
    profile.boot(filesystem, { computerName: "c-dos006" });
    filesystem.writeFile(
      "/drives/c/config.sys",
      Array.from({ length: 65 }, () => "FILES=32").join("\r\n"),
    );

    const shell = new ShellSession(filesystem, { osProfile: "dos" });

    expect(shell.takeStartupLines()).toContain(
      "CONFIG.SYS line 65: CONFIG.SYS supports at most 64 lines",
    );
    expect(shell.submit("MEM /D").lines).toContain(
      "Memory manager state: degraded-low",
    );
  });
});
