import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { getOsProfile } from "../../src/application/os/osProfile.js";
import { portableComputerHardware } from "../../src/domain/computer/hardware.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("DOS profile contract", (): void => {
  it("supports drive paths, case-insensitive lookup, CRLF boot files, and NUL", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, {
      computerName: "c-dos002",
      osProfile: "dos",
    });

    expect(shell.submit("CD C:\\DOS").exitCode).toBe(0);
    expect(shell.submit("PWD").lines).toEqual(["C:\\DOS"]);
    expect(
      shell.submit("ECHO VALUE > C:\\Users\\Computer\\Mixed.TXT").exitCode,
    ).toBe(0);
    expect(shell.submit("TYPE c:\\USERS\\COMPUTER\\mixed.txt").lines).toEqual([
      "VALUE",
    ]);
    expect(filesystem.readFile("/drives/c/autoexec.bat")).toContain("\r\n");
    expect(shell.submit("ECHO ignored > NUL").exitCode).toBe(0);
    expect(filesystem.exists("/drives/c/nul")).toBe(false);
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
      memoryUsageBytes: (): number => 65_536,
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
      "       65536 bytes guest runtime",
    );
    expect(shell.submit("MEM /C").lines).toContain(
      "      131072 bytes DOS system and drivers",
    );
    expect(shell.submit("MEM /C").stdout).toContain("DOS KERNEL");
    expect(shell.submit("MEM /C").stdout).toContain("HIMEM/EMM386");
    expect(shell.submit("MEM /D").lines).toContain(
      "CPU mode: protected sandbox",
    );
    expect(shell.submit("MEM /D").lines).toContain(
      "XMS driver (HIMEM.SYS): installed",
    );
    expect(shell.submit("MEM /D").lines).toContain("UMB link: enabled");
    expect(shell.submit("MEM /P").exitCode).toBe(2);
    expect(shell.submit("SYSTEMINFO").lines).toContain("Computer ID: c-dos002");
    expect(shell.submit("VER").lines[0]).toContain("Computer System DOS 6.2");
    expect(shell.submit("ECHO %OS%").lines).toEqual(["CS-DOS"]);
    expect(shell.submit("SYSTEMINFO").lines).toContain("OS Alias: CS-DOS 6.2");
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
    expect(dos.submit("DATE").lines).toEqual(["2000-02-29T23:59:59.000Z"]);

    wallTime = Date.UTC(2040, 0, 1);
    expect(Number(linux.submit("date +%s").lines[0])).toBeGreaterThan(
      2_147_483_647,
    );
    expect(dos.submit("DATE").lines).toEqual(["2040-01-01T00:00:00.000Z"]);
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
    expect(shell.submit("C++ C:\\answer.cpp -O C:\\answer-cpp").exitCode).toBe(
      0,
    );
    expect(shell.submit("C:\\answer-cpp").stdout).toBe("42\n");
    expect(shell.submit("RUN --STATS C:\\answer-cpp").stderr).toContain(
      "CS386SX",
    );
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
    expect(shell.submit("SET CONFIG_FILES").lines).toEqual(["CONFIG_FILES=40"]);
    expect(shell.submit("PATH").lines).toEqual(["PATH=C:\\TOOLS;C:\\DOS"]);
    expect(shell.prompt()).toBe("[C]C:\\USERS\\COMPUTER> ");
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
        "FALSE",
        "ECHO %ERRORLEVEL%",
        "SET RESULT=%2",
        "",
      ].join("\r\n"),
    );
    const shell = new ShellSession(filesystem, { osProfile: "dos" });

    const result = shell.submit("HELLO alpha beta");
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["C:\\TOOLS\\HELLO.BAT", "alpha", "1"]);
    expect(shell.submit("SET RESULT").lines).toEqual(["RESULT=beta"]);
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
      "CONFIG.SYS line 1: unsupported directive DEVICE=C:\\DOS\\UNKNOWN.SYS",
      "CONFIG.SYS line 2: unsupported directive SHELL=C:\\4DOS.COM",
    ]);
  });

  it("terminates oversized and recursively nested batch work explicitly", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile(
      "/drives/c/users/computer/large.bat",
      Array.from({ length: 257 }, () => "REM bounded").join("\r\n"),
    );
    filesystem.writeFile(
      "/drives/c/users/computer/loop.bat",
      "@ECHO OFF\r\nLOOP\r\n",
    );

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
      "C:\\CONFIG.SYS: configuration line limit exceeded",
    );
  });
});
