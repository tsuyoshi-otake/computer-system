import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import {
  compileCs486Object,
  compileCs486Source,
} from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
  type Cs486Executable,
} from "../../src/domain/cpu/cs486.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

function declaredLinearMemoryBytes(executable: Cs486Executable): number {
  const requirements = cs486ExecutableMemoryRequirements(executable);
  if (requirements.kind !== "declared") {
    throw new Error("toolchain writer produced a legacy executable");
  }
  return requirements.linearAddressSpaceBytes;
}

describe("CS486DX shell toolchain", (): void => {
  it("assembles, inspects, and executes a CS486 program", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.makeDirectory("/work");
    filesystem.writeFile(
      "/work/sum.asm",
      "mov eax, 20\nadd eax, 22\nprint eax\nhalt\n",
    );

    expect(shell.submit("as /work/sum.asm -o /work/sum").exitCode).toBe(0);
    expect(shell.submit("/work/sum").stdout).toBe("42");
    const measured = shell.submit("run --stats /work/sum");
    expect(measured.stderr).toMatch(
      /4 instructions, \d+ CPU cycles, \d+\.\d{3} us at 33 MHz, halted/u,
    );
    expect(measured.stderr).toMatch(
      /memory: L1 \d+ hit\/\d+ miss, L2 \d+ hit\/\d+ miss, \d+ bus transfers, \d+ unaligned, \d+ pipeline flushes/u,
    );
    expect(shell.submit("objdump /work/sum").stdout).toContain('"op":"add"');
  });

  it("compiles BASIC, C, and C++ subsets to the same executable format", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.makeDirectory("/work");
    filesystem.writeFile(
      "/work/sum.bas",
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
      "/work/sum.c",
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
      "/work/answer.cpp",
      [
        "int main() {",
        "int answer = 6 * 7;",
        "std::cout << answer << std::endl;",
        "return 0;",
        "}",
      ].join("\n"),
    );

    const basicExecutable = compileCs486Source(
      "basic",
      filesystem.readFile("/work/sum.bas"),
    );
    expect(
      runCs486(basicExecutable, {
        memoryBytes: declaredLinearMemoryBytes(basicExecutable),
      }).output,
    ).toBe("15\n");
    expect(shell.submit("basic /work/sum.bas").exitCode).toBe(127);
    expect(shell.submit("basicc /work/sum.bas").exitCode).toBe(127);
    expect(shell.submit("cc /work/sum.c -o /work/sum-c").exitCode).toBe(0);
    expect(shell.submit("c++ /work/answer.cpp -o /work/answer").exitCode).toBe(
      0,
    );
    expect(shell.submit("/work/sum-c").stdout).toBe("15\n");
    expect(shell.submit("/work/answer").stdout).toBe("42\n");
  });

  it("lowers a C for loop to an explicit CFG with a backward edge", (): void => {
    const executable = compileCs486Source(
      "c",
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
    const result = runCs486(executable, {
      memoryBytes: declaredLinearMemoryBytes(executable),
    });

    expect(result.output).toBe("15\n");
    expect(result.registers.esp).toBe(declaredLinearMemoryBytes(executable));
    expect(
      executable.instructions.some((instruction) =>
        ["jg", "jge", "jl", "jle"].includes(instruction.op),
      ),
    ).toBe(true);
    expect(
      executable.instructions.some(
        (instruction, index) =>
          instruction.op === "jmp" && instruction.target < index,
      ),
    ).toBe(true);
  });

  it("spills a high-pressure nested expression while restoring ESP", (): void => {
    const localNames = [
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
      "k",
      "l",
    ] as const;
    const nestedExpression = localNames.reduceRight(
      (expression, name) =>
        expression.length === 0 ? name : `${name} + (${expression})`,
      "",
    );
    const object = compileCs486Object(
      "c",
      [
        "int main() {",
        ...localNames.map(
          (name, index) => `int ${name} = ${String(index + 1)};`,
        ),
        `int answer = ${nestedExpression};`,
        'printf("%d\\n", answer);',
        "return answer;",
        "}",
      ].join("\n"),
    );
    const executable = linkCs486Objects([object]);
    const result = runCs486(executable, {
      memoryBytes: declaredLinearMemoryBytes(executable),
    });
    const frameOffsets = [
      ...object.assembly.matchAll(/^sub ecx, (\d+)$/gmu),
    ].map((match) => Number(match[1]));

    expect(result.output).toBe("78\n");
    expect(result.registers.esp).toBe(declaredLinearMemoryBytes(executable));
    expect(object.dataBytes).toBe(0);
    expect(Math.max(...frameOffsets)).toBeGreaterThan(localNames.length * 4);
  });

  it("completes a bounded compiled workload larger than 10,000 instructions", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.makeDirectory("/work");
    filesystem.writeFile(
      "/work/strength.asm",
      [
        "mov eax, 0",
        "mov ecx, 1",
        "loop:",
        "mov edx, ecx",
        "mul edx, ecx",
        "mov ebx, ecx",
        "mul ebx, 3",
        "add edx, ebx",
        "add edx, 7",
        "add eax, edx",
        "add ecx, 1",
        "cmp ecx, 1500",
        "jle loop",
        "print eax",
        "halt",
      ].join("\n"),
    );

    expect(
      shell.submit("as /work/strength.asm -o /work/strength").exitCode,
    ).toBe(0);
    const measured = shell.submit("run --stats /work/strength");
    expect(measured.exitCode).toBe(0);
    expect(measured.stdout).toBe("1129513000");
    expect(measured.stderr).toMatch(/1[0-9]{4} instructions.*halted/u);
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
    filesystem.makeDirectory("/work");
    filesystem.writeFile(
      "/work/answer.asm",
      [
        "global fast_answer",
        "fast_answer:",
        "mov eax, 6",
        "mul eax, 7",
        "ret",
      ].join("\n"),
    );
    filesystem.writeFile(
      "/work/main.c",
      [
        "extern int fast_answer();",
        "int main() {",
        "int answer = fast_answer();",
        'printf("%d\\n", answer);',
        "return 0;",
        "}",
      ].join("\n"),
    );

    expect(
      shell.submit("as -c /work/answer.asm -o /work/answer.o").exitCode,
    ).toBe(0);
    expect(shell.submit("cc -c /work/main.c -o /work/main.o").exitCode).toBe(0);
    expect(shell.submit("nm /work/answer.o").stdout).toContain("T fast_answer");
    expect(shell.submit("nm /work/main.o").stdout).toContain("U fast_answer");
    expect(shell.submit("objdump /work/main.o").stdout).toContain(
      "reloc text-target",
    );
    expect(
      shell.submit("ld /work/main.o /work/answer.o -o /work/linked").exitCode,
    ).toBe(0);
    expect(shell.submit("nm /work/linked").stdout).toContain("T main");
    const result = shell.submit("run --stats /work/linked");
    expect(result).toMatchObject({ exitCode: 0, stdout: "42\n" });
    expect(result.stderr).toContain("CPU cycles");
  });

  it("renders floating ABI signatures in nm and objdump", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.makeDirectory("/work");
    filesystem.writeFile(
      "/work/float.c",
      [
        "double scale(double value){return value * 2.0;}",
        "int main(void){return scale(1.5) == 3.0 ? 0 : 1;}",
      ].join("\n"),
    );

    expect(shell.submit("cc -c /work/float.c -o /work/float.o")).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(shell.submit("nm /work/float.o").stdout).toContain(
      "scale (f64)->f64",
    );
    expect(shell.submit("objdump /work/float.o").stdout).toContain(
      "scale @0 (f64)->f64",
    );
    expect(shell.submit("ld /work/float.o -o /work/float")).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(shell.submit("objdump /work/float").stdout).toMatch(
      /function @\d+ \(f64\)->f64/u,
    );
    expect(shell.submit("run /work/float").exitCode).toBe(0);
  });

  it("compiles BASIC objects and restricted inline assembly", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.makeDirectory("/work");
    filesystem.writeFile(
      "/work/answer.bas",
      "10 LET ANSWER = 6 * 7\n20 PRINT ANSWER\n30 END\n",
    );
    filesystem.writeFile(
      "/work/inline.cpp",
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

    filesystem.writeFile(
      "/work/answer.o",
      `CS486OBJ\n${JSON.stringify(
        compileCs486Object("basic", filesystem.readFile("/work/answer.bas")),
      )}`,
    );
    expect(shell.submit("ld /work/answer.o -o /work/answer").exitCode).toBe(0);
    expect(shell.submit("/work/answer").stdout).toBe("42\n");
    expect(shell.submit("c++ /work/inline.cpp -o /work/inline").exitCode).toBe(
      0,
    );
    expect(shell.submit("/work/inline").stdout).toBe("42\n");

    filesystem.writeFile(
      "/work/unsafe.c",
      'int main() {\nasm("push eax");\nreturn 0;\n}\n',
    );
    expect(shell.submit("cc /work/unsafe.c -o /work/unsafe")).toMatchObject({
      exitCode: 1,
    });
    expect(shell.submit("cc /work/unsafe.c -o /work/unsafe").stderr).toContain(
      "unsafe inline assembly",
    );
  });

  it("rejects duplicate and unresolved link symbols explicitly", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.makeDirectory("/work");
    filesystem.writeFile(
      "/work/first.asm",
      "global _start\n_start:\ncall missing\nhalt\nextern missing\n",
    );
    filesystem.writeFile(
      "/work/duplicate.asm",
      "global _start\n_start:\nhalt\n",
    );
    expect(
      shell.submit("as -c /work/first.asm -o /work/first.o").exitCode,
    ).toBe(0);
    expect(
      shell.submit("as -c /work/duplicate.asm -o /work/duplicate.o").exitCode,
    ).toBe(0);
    expect(shell.submit("ld /work/first.o -o /work/missing").stderr).toContain(
      "unresolved symbol missing",
    );
    expect(
      shell.submit("ld /work/first.o /work/duplicate.o -o /work/duplicate")
        .stderr,
    ).toContain("duplicate symbol _start");
  });

  it("preserves C and C++ expression, call, and local-scope semantics on Linux and DOS", (): void => {
    const cSource = [
      "int helper() {",
      "int value = 40;",
      "return value;",
      "}",
      "int main() {",
      "int value = 1;",
      "int Value = 2;",
      "int adjustment = -1;",
      "int answer = helper() + value + Value + adjustment;",
      'printf("%d\\n", answer);',
      "return answer;",
      "}",
    ].join("\n");
    const cppSource = [
      "int helper() {",
      "int value = 43;",
      "return value;",
      "}",
      "int main() {",
      "int value = -1;",
      "int answer = helper() + value;",
      "std::cout << answer << std::endl;",
      "return answer;",
      "}",
    ].join("\n");

    for (const profile of ["linux", "dos"] as const) {
      const filesystem = new InMemoryFilesystem();
      const shell = new ShellSession(filesystem, { osProfile: profile });
      if (profile === "linux") {
        filesystem.makeDirectory("/work");
        filesystem.writeFile("/work/good.c", cSource);
        filesystem.writeFile("/work/good.cpp", cppSource);
        expect(
          shell.submit("cc /work/good.c -o /work/good-c"),
          `${profile} C compile`,
        ).toMatchObject({ exitCode: 0, stderr: "" });
        expect(
          shell.submit("c++ /work/good.cpp -o /work/good-cpp"),
          `${profile} C++ compile`,
        ).toMatchObject({ exitCode: 0, stderr: "" });
        expect(shell.submit("/work/good-c").stdout).toBe("42\n");
        expect(shell.submit("/work/good-cpp").stdout).toBe("42\n");
      } else {
        filesystem.writeFile("/drives/c/good.c", cSource);
        filesystem.writeFile("/drives/c/good.cpp", cppSource);
        expect(
          shell.submit("CC C:\\GOOD.C /OUT:C:\\GOODC"),
          `${profile} C compile`,
        ).toMatchObject({ exitCode: 0, stderr: "" });
        expect(
          shell.submit("C++ C:\\GOOD.CPP /OUT:C:\\GOODCPP"),
          `${profile} C++ compile`,
        ).toMatchObject({ exitCode: 0, stderr: "" });
        expect(shell.submit("C:\\GOODC").stdout).toBe("42\r\n");
        expect(shell.submit("C:\\GOODCPP").stdout).toBe("42\r\n");
      }
    }
  });

  it.each([
    ["c", "shadow.c"],
    ["cpp", "shadow.cpp"],
  ] as const)(
    "rejects a %s call when a lexical local shadows the function",
    (language, sourceName): void => {
      let error: unknown;
      try {
        compileCs486Object(
          language,
          [
            "int helper() { return 42; }",
            "int main() {",
            "int helper = 7;",
            "return helper();",
            "}",
          ].join("\n"),
          { sourceName },
        );
      } catch (candidate: unknown) {
        error = candidate;
      }

      expect(error).toMatchObject({
        code: "CSC001",
        column: 8,
        detail: "called object helper is not a function",
        line: 4,
        notes: [
          {
            message: "helper was declared as a local variable here",
            span: { start: { column: 5, line: 3, source: sourceName } },
          },
        ],
        source: sourceName,
      });
    },
  );

  it.each([
    ["c", "order.c"],
    ["cpp", "order.cpp"],
  ] as const)(
    "requires a %s function declaration before use while accepting a prototype",
    (language, sourceName): void => {
      const definition = "int helper() { return 42; }";
      const main = "int main() { return helper(); }";

      expect(() =>
        compileCs486Object(language, [main, definition].join("\n"), {
          sourceName,
        }),
      ).toThrow(
        new RegExp(
          `${sourceName.replace(".", "\\.")}:1:21: undeclared function helper; functions must be declared before use`,
          "u",
        ),
      );

      const executable = compileCs486Source(
        language,
        ["int helper();", main, definition].join("\n"),
        { sourceName },
      );
      const result = runCs486(executable, {
        memoryBytes: declaredLinearMemoryBytes(executable),
      });
      expect(result.registers.eax).toBe(42);
      expect(result.registers.esp).toBe(declaredLinearMemoryBytes(executable));
    },
  );

  it("rejects invalid C and C++ frontend input explicitly on Linux and DOS", (): void => {
    const cases: readonly {
      readonly detail: RegExp;
      readonly extension: "c" | "cpp";
      readonly name: string;
      readonly source: string;
    }[] = [
      {
        detail: /undeclared identifier.*missing/iu,
        extension: "c",
        name: "undeclared identifier",
        source: "int main() {\nreturn missing;\n}\n",
      },
      {
        detail: /duplicate declaration.*value/iu,
        extension: "c",
        name: "duplicate local declaration",
        source:
          "int main() {\nint value = 1;\nint value = 2;\nreturn value;\n}\n",
      },
      {
        detail: /preprocessor|directive/iu,
        extension: "c",
        name: "unsupported preprocessor directive",
        source: "#pragma pack(1)\nint main() {\nreturn 42;\n}\n",
      },
      {
        detail: /global initializer|bounded constant|undeclared identifier/iu,
        extension: "c",
        name: "non-constant top-level global",
        source: "int answer = missing;\nint main() {\nreturn answer;\n}\n",
      },
      {
        detail: /expression|operand/iu,
        extension: "c",
        name: "missing expression operand",
        source: "int main() {\nint answer = 1 + ;\nreturn answer;\n}\n",
      },
      {
        detail: /expression|unbalanced|parenthes/iu,
        extension: "cpp",
        name: "unbalanced expression",
        source: "int main() {\nreturn (1 + 2;\n}\n",
      },
      {
        detail: /unsupported|class|C\+\+/iu,
        extension: "cpp",
        name: "unsupported C++ class",
        source:
          "class Answer {\npublic:\nint value;\n};\nint main() {\nreturn 0;\n}\n",
      },
    ];

    for (const profile of ["linux", "dos"] as const) {
      const filesystem = new InMemoryFilesystem();
      const shell = new ShellSession(filesystem, { osProfile: profile });
      if (profile === "linux") filesystem.makeDirectory("/work");

      for (const [index, testCase] of cases.entries()) {
        const stem = `bad${String(index)}`;
        const sourcePath =
          profile === "linux"
            ? `/work/${stem}.${testCase.extension}`
            : `/drives/c/${stem}.${testCase.extension}`;
        const outputPath =
          profile === "linux"
            ? `/work/out${String(index)}`
            : `/drives/c/out${String(index)}`;
        const command =
          profile === "linux"
            ? `${testCase.extension === "c" ? "cc" : "c++"} ${sourcePath} -o ${outputPath}`
            : `${testCase.extension === "c" ? "CC" : "C++"} C:\\${stem.toUpperCase()}.${testCase.extension.toUpperCase()} /OUT:C:\\OUT${String(index)}`;
        filesystem.writeFile(sourcePath, testCase.source);

        const result = shell.submit(command);
        expect(result.exitCode, `${profile}: ${testCase.name} must fail`).toBe(
          1,
        );
        expect(result.stdout, `${profile}: ${testCase.name} stdout`).toBe("");
        expect(
          result.stderr,
          `${profile}: ${testCase.name} diagnostic`,
        ).toMatch(testCase.detail);
        expect(
          result.stderr,
          `${profile}: ${testCase.name} error code`,
        ).toMatch(/error [A-Z0-9]+:/u);
        expect(
          filesystem.exists(outputPath),
          `${profile}: ${testCase.name} output file`,
        ).toBe(false);
        expect(
          result.stderr.endsWith(profile === "dos" ? "\r\n" : "\n"),
          `${profile}: ${testCase.name} newline`,
        ).toBe(true);
      }
    }
  });
});
