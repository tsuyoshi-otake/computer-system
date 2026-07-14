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
    expect(measured.stderr).toMatch(
      /memory: L1 \d+ hit\/\d+ miss, L2 \d+ hit\/\d+ miss, \d+ bus transfers, \d+ unaligned, \d+ pipeline flushes/u,
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
    expect(linux.submit("cpuinfo").stdout).toContain("l1 cache\t: 8 KiB");
    expect(linux.submit("cpuinfo").stdout).toContain("pipeline\t: five-stage");
    expect(dos.submit("CPU").stdout).toContain("33 MHz");
    expect(dos.submit("CPU").stdout).toContain("L1 cache: 8 KiB");
    expect(dos.submit("SYSTEMINFO").stdout).toContain("Computer System 486DX");
  });

  it("links C and ASM objects through global and external symbols", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile(
      "/answer.asm",
      [
        "global fast_answer",
        "fast_answer:",
        "mov eax, 6",
        "mul eax, 7",
        "ret",
      ].join("\n"),
    );
    filesystem.writeFile(
      "/main.c",
      [
        "extern int fast_answer();",
        "int main() {",
        "int answer = fast_answer();",
        'printf("%d\\n", answer);',
        "return 0;",
        "}",
      ].join("\n"),
    );

    expect(shell.submit("as -c /answer.asm -o /answer.o").exitCode).toBe(0);
    expect(shell.submit("cc -c /main.c -o /main.o").exitCode).toBe(0);
    expect(shell.submit("nm /answer.o").stdout).toContain("T fast_answer");
    expect(shell.submit("nm /main.o").stdout).toContain("U fast_answer");
    expect(shell.submit("objdump /main.o").stdout).toContain(
      "reloc text-target",
    );
    expect(shell.submit("ld /main.o /answer.o -o /linked").exitCode).toBe(0);
    expect(shell.submit("nm /linked").stdout).toContain("T main");
    const result = shell.submit("run --stats /linked");
    expect(result).toMatchObject({ exitCode: 0, stdout: "42\n" });
    expect(result.stderr).toContain("CPU cycles");
  });

  it("compiles BASIC objects and restricted inline assembly", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile(
      "/answer.bas",
      "10 LET ANSWER = 6 * 7\n20 PRINT ANSWER\n30 END\n",
    );
    filesystem.writeFile(
      "/inline.cpp",
      [
        "int main() {",
        "int answer = 0;",
        'asm("mov eax, 6");',
        'asm("mul eax, 7");',
        'asm("store [answer], eax");',
        "std::cout << answer << std::endl;",
        "return 0;",
        "}",
      ].join("\n"),
    );

    expect(shell.submit("basicc -c /answer.bas -o /answer.o").exitCode).toBe(0);
    expect(shell.submit("ld /answer.o -o /answer").exitCode).toBe(0);
    expect(shell.submit("/answer").stdout).toBe("42\n");
    expect(shell.submit("c++ /inline.cpp -o /inline").exitCode).toBe(0);
    expect(shell.submit("/inline").stdout).toBe("42\n");

    filesystem.writeFile(
      "/unsafe.c",
      'int main() {\nasm("push eax");\nreturn 0;\n}\n',
    );
    expect(shell.submit("cc /unsafe.c -o /unsafe")).toMatchObject({
      exitCode: 1,
    });
    expect(shell.submit("cc /unsafe.c -o /unsafe").stderr).toContain(
      "unsafe inline assembly",
    );
  });

  it("rejects duplicate and unresolved link symbols explicitly", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile(
      "/first.asm",
      "global _start\n_start:\ncall missing\nhalt\nextern missing\n",
    );
    filesystem.writeFile("/duplicate.asm", "global _start\n_start:\nhalt\n");
    expect(shell.submit("as -c /first.asm -o /first.o").exitCode).toBe(0);
    expect(shell.submit("as -c /duplicate.asm -o /duplicate.o").exitCode).toBe(
      0,
    );
    expect(shell.submit("ld /first.o -o /missing").stderr).toContain(
      "unresolved symbol missing",
    );
    expect(
      shell.submit("ld /first.o /duplicate.o -o /duplicate").stderr,
    ).toContain("duplicate symbol _start");
  });
});
