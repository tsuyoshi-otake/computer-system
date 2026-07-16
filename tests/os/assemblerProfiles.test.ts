import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { portableComputerHardware } from "../../src/domain/computer/hardware.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("OS-specific CS486 assembler adapters", (): void => {
  it("resolves Linux includes relative to the source and accepts ld -e", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.makeDirectory("/src");
    filesystem.writeFile("/src/value.inc", "VALUE equ 40 + 2\n");
    filesystem.writeFile(
      "/src/main.asm",
      [
        '%include "value.inc"',
        "global main",
        "main:",
        "mov eax, VALUE",
        "print eax",
        "halt",
      ].join("\n"),
    );

    expect(shell.submit("as -c /src/main.asm -o /src/main.o").exitCode).toBe(0);
    expect(
      shell.submit("ld -e main /src/main.o -o /src/program").exitCode,
    ).toBe(0);
    expect(shell.submit("/src/program").stdout).toBe("42");
  });

  it("supports DOS aliases and options while keeping diagnostics CRLF-only", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, {
      hardware: portableComputerHardware,
      osProfile: "dos",
    });
    filesystem.writeFile(
      "/drives/c/common.inc",
      "EMIT MACRO VALUE\r\nmov eax, VALUE\r\nprint eax\r\nENDM\r\n",
    );
    filesystem.writeFile(
      "/drives/c/main.asm",
      [
        'INCLUDE "COMMON.INC"',
        ".CODE",
        "PUBLIC MAIN",
        "MAIN:",
        "EMIT 2Ah",
        "halt",
      ].join("\r\n"),
    );

    expect(shell.submit("ASM MAIN.ASM /C /OUT:MAIN.CSO").exitCode).toBe(0);
    const symbols = shell.submit("NM MAIN.CSO");
    const dump = shell.submit("OBJDUMP MAIN.CSO");
    expect(symbols.stdout).toContain("T MAIN");
    expect(symbols.stdout).not.toMatch(/(?<!\r)\n/u);
    expect(dump.stdout).not.toMatch(/(?<!\r)\n/u);
    expect(
      shell.submit("LINK MAIN.CSO /ENTRY:MAIN /OUT:APP.CSX").exitCode,
    ).toBe(0);
    const run = shell.submit("RUN APP.CSX /STATS");
    expect(run).toMatchObject({ exitCode: 0, stdout: "42" });
    expect(run.stderr).toContain("CS386SX");
    expect(run.stderr).not.toMatch(/(?<!\r)\n/u);
    const asmUsage = shell.submit("ASM");
    const linkUsage = shell.submit("LINK");
    expect(asmUsage.stderr).toContain("Usage: ASM [/C]");
    expect(linkUsage.stderr).toContain(
      "Usage: LINK <objects...> [/OUT:output]",
    );
    expect(asmUsage.stderr).not.toMatch(/(?<!\r)\n/u);
    expect(linkUsage.stderr).not.toMatch(/(?<!\r)\n/u);

    filesystem.writeFile("/drives/c/native.asm", "ORG 100h\r\n");
    const rejected = shell.submit("AS NATIVE.ASM /OUT:NATIVE.CSX");
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toMatch(
      /^C:\\NATIVE\.ASM\(1,1\): error CSASM001:/u,
    );
    expect(rejected.stderr).not.toMatch(/(?<!\r)\n/u);
  });
});
