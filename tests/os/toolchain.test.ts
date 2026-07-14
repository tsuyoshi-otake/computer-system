import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("CS486DX shell toolchain", (): void => {
  it("assembles, inspects, and executes a CS486 program", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile(
      "/sum.asm",
      "mov eax, 20\nadd eax, 22\nprint eax\nhalt\n",
    );

    expect(shell.submit("as /sum.asm -o /sum").exitCode).toBe(0);
    expect(shell.submit("/sum").stdout).toBe("42");
    const measured = shell.submit("run --stats /sum");
    expect(measured.stderr).toMatch(
      /4 instructions, \d+ CPU cycles, \d+\.\d{3} us at 33 MHz, halted/u,
    );
    expect(shell.submit("objdump /sum").stdout).toContain('"op":"add"');
  });

  it("compiles BASIC, C, and C++ subsets to the same executable format", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile(
      "/sum.bas",
      [
        "10 LET TOTAL = 0",
        "20 FOR I = 1 TO 5",
        "30 LET TOTAL = TOTAL + I",
        "40 NEXT I",
        "50 PRINT TOTAL",
        "60 END",
      ].join("\n"),
    );
    filesystem.writeFile(
      "/sum.c",
      [
        "int main() {",
        "int total = 0;",
        "for (int i = 1; i <= 5; i++) {",
        "total = total + i;",
        "}",
        'printf("%d\\n", total);',
        "return 0;",
        "}",
      ].join("\n"),
    );
    filesystem.writeFile(
      "/answer.cpp",
      [
        "int main() {",
        "int answer = 6 * 7;",
        "std::cout << answer << std::endl;",
        "return 0;",
        "}",
      ].join("\n"),
    );

    expect(shell.submit("basic /sum.bas").stdout).toBe("15\n");
    expect(shell.submit("basicc /sum.bas -o /sum-basic").exitCode).toBe(0);
    expect(shell.submit("cc /sum.c -o /sum-c").exitCode).toBe(0);
    expect(shell.submit("c++ /answer.cpp -o /answer").exitCode).toBe(0);
    expect(shell.submit("/sum-basic").stdout).toBe("15\n");
    expect(shell.submit("/sum-c").stdout).toBe("15\n");
    expect(shell.submit("/answer").stdout).toBe("42\n");
  });

  it("shows the nominal 486DX 33 MHz identity in Linux and DOS", (): void => {
    const linux = new ShellSession(new InMemoryFilesystem());
    const dos = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });

    expect(linux.submit("cpuinfo").stdout).toContain("Computer System 486DX");
    expect(linux.submit("cpuinfo").stdout).toContain("33 MHz");
    expect(dos.submit("CPU").stdout).toContain("33 MHz");
    expect(dos.submit("SYSTEMINFO").stdout).toContain("Computer System 486DX");
  });
});
