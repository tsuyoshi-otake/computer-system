import { describe, expect, it } from "vitest";

import { Cs486CompileError } from "../../src/application/toolchain/cs486Assembler.js";
import {
  cs486CPreprocessorLimits,
  preprocessCs486C,
  type Cs486CPreprocessorInclude,
} from "../../src/application/toolchain/cs486CPreprocessor.js";
import { compileCs486Source } from "../../src/application/toolchain/highLevelCompilers.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";

function raw(source: string): string {
  return preprocessCs486C(source, { sourceName: "/work/main.c" })
    .map((token) => token.raw)
    .join(" ");
}

describe("CS486 C-family preprocessor", (): void => {
  it("rescans object/function macros and physical line continuations", (): void => {
    expect(
      raw(
        [
          "#define BASE 40",
          "#define ADD(a, b) ((a) + (b))",
          "#define ANSWER ADD(BASE, \\",
          "2)",
          "int main() { return ANSWER; }",
        ].join("\n"),
      ),
    ).toBe("int main ( ) { return ( ( 40 ) + ( 2 ) ) ; }");
  });

  it("implements stringification and token pasting before rescanning", (): void => {
    const tokens = preprocessCs486C(
      [
        "#define NAME answer",
        "#define MAKE(prefix, suffix) prefix ## suffix",
        "#define TEXT(value) #value",
        "int MAKE(an, swer)() { printf(TEXT(ready)); return 0; }",
      ].join("\n"),
      { sourceName: "/work/macros.c" },
    );

    expect(tokens.map((token) => token.raw)).toContain("answer");
    expect(tokens.find((token) => token.kind === "string")?.value).toBe(
      "ready",
    );
  });

  it("expands variadic macros and dynamic source-location macros", (): void => {
    const tokens = preprocessCs486C(
      [
        "#define VALUES(first, ...) first, __VA_ARGS__",
        "#define TEXT(...) #__VA_ARGS__",
        "int values[] = { VALUES(1, 2, 3) };",
        "const char *before = __FILE__;",
        '#line 90 "generated.c"',
        "int line = __LINE__;",
        "const char *after = __FILE__;",
        "const char *text = TEXT(a, b);",
      ].join("\n"),
      { sourceName: "/work/macros.c" },
    );

    expect(tokens.map((token) => token.raw).join(" ")).toContain(
      "{ 1 , 2 , 3 }",
    );
    expect(tokens.find((token) => token.value === "/work/macros.c")?.raw).toBe(
      '"/work/macros.c"',
    );
    expect(
      tokens.find((token) => token.raw === "90")?.span.start,
    ).toMatchObject({ line: 90, source: "generated.c" });
    expect(tokens.find((token) => token.value === "generated.c")?.raw).toBe(
      '"generated.c"',
    );
    expect(tokens.find((token) => token.value === "a, b")?.kind).toBe("string");
  });

  it("honors pragma once by normalized include identity", (): void => {
    let loads = 0;
    const tokens = preprocessCs486C(
      '#include "guarded.h"\n#include "alias.h"\nint x = VALUE;\n',
      {
        include: () => {
          loads += 1;
          return {
            identity: "/usr/include/guarded.h",
            source: "#pragma once\n#define VALUE 42\n",
            sourceName: "/usr/include/guarded.h",
          };
        },
        sourceName: "/work/main.c",
      },
    );

    expect(loads).toBe(2);
    expect(tokens.map((token) => token.raw).join(" ")).toContain("x = 42");
  });

  it("evaluates defined and bounded integer conditional expressions", (): void => {
    expect(
      raw(
        [
          "#define FEATURE 3",
          "#if defined(FEATURE) && FEATURE * 2 == 6",
          "int main() { return 1; }",
          "#elif FEATURE",
          "int main() { return 2; }",
          "#else",
          "#error wrong branch",
          "#endif",
        ].join("\n"),
      ),
    ).toContain("return 1");
  });

  it("loads quoted and angle includes with authored source provenance", (): void => {
    const files = new Map([
      [
        "local.h",
        {
          identity: "/work/local.h",
          source:
            "#ifndef LOCAL_H\n#define LOCAL_H\n#define LOCAL 40\n#endif\n",
          sourceName: "/work/local.h",
        },
      ],
      [
        "system.h",
        {
          identity: "/usr/include/system.h",
          source: "#define SYSTEM 2\n",
          sourceName: "/usr/include/system.h",
        },
      ],
    ]);
    const requests: { readonly path: string; readonly quoted: boolean }[] = [];
    const tokens = preprocessCs486C(
      '#include "local.h"\n#include <system.h>\nint main() { return LOCAL + SYSTEM; }\n',
      {
        include: (request) => {
          requests.push({ path: request.path, quoted: request.quoted });
          return files.get(request.path);
        },
        sourceName: "/work/main.c",
      },
    );

    expect(requests).toEqual([
      { path: "local.h", quoted: true },
      { path: "system.h", quoted: false },
    ]);
    expect(tokens.map((token) => token.raw).join(" ")).toContain(
      "return 40 + 2",
    );
    expect(tokens.find((token) => token.raw === "40")?.span.start.source).toBe(
      "/work/main.c",
    );
    expect(
      tokens.find((token) => token.raw === "40")?.span.diagnosticNotes?.[0]
        ?.span?.start.source,
    ).toBe("/work/local.h");
  });

  it("reports bounded include and macro provenance in frontend errors", (): void => {
    expect.assertions(10);
    try {
      compileCs486Source("c", "#define BAD class\nBAD\n", {
        sourceName: "/work/main.c",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Cs486CompileError);
      const diagnostic = error as Cs486CompileError;
      expect(diagnostic.source).toBe("/work/main.c");
      expect(diagnostic.line).toBe(2);
      expect(diagnostic.notes[0]?.message).toMatch(/expanded from macro BAD/u);
      expect(diagnostic.notes[0]?.span?.start.line).toBe(1);
    }

    try {
      compileCs486Source("c", '#include "1.h"\n', {
        include: ({ path }) => {
          const number = Number.parseInt(path, 10);
          return {
            identity: `/work/${String(number)}.h`,
            source:
              number === 10
                ? "class\n"
                : `#include "${String(number + 1)}.h"\n`,
            sourceName: `/work/${String(number)}.h`,
          };
        },
        sourceName: "/work/main.c",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Cs486CompileError);
      const diagnostic = error as Cs486CompileError;
      expect(diagnostic.source).toBe("/work/10.h");
      expect(diagnostic.line).toBe(1);
      expect(diagnostic.notes).toHaveLength(8);
      expect(diagnostic.notes[0]?.span?.start.source).toBe("/work/9.h");
    }
  });

  it("applies command-line definitions and undefines deterministically", (): void => {
    const result = preprocessCs486C(
      "#if VALUE == 42 && !defined(REMOVED)\nint main(){return VALUE;}\n#endif\n",
      {
        definitions: [
          { name: "VALUE", replacement: "42" },
          { name: "REMOVED" },
        ],
        sourceName: "C:\\WORK\\MAIN.C",
        undefines: ["REMOVED"],
      },
    );
    expect(result.map((token) => token.raw).join(" ")).toContain("return 42");
  });

  it("feeds expanded tokens into the existing parser, IR, and backend", (): void => {
    const executable = compileCs486Source(
      "c",
      [
        "#define VALUE 42",
        "int main() {",
        'printf("%d\\n", VALUE);',
        "return 0;",
        "}",
      ].join("\n"),
      { sourceName: "/work/main.c" },
    );

    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared") {
      throw new Error("C compiler produced a legacy executable");
    }
    expect(
      runCs486(executable, {
        memoryBytes: requirements.linearAddressSpaceBytes,
      }).output,
    ).toBe("42\n");
  });

  it("rejects missing/circular includes and unsupported directives explicitly", (): void => {
    expect(() =>
      preprocessCs486C("#include <missing.h>\n", {
        sourceName: "/work/main.c",
      }),
    ).toThrow(/include file not found: missing\.h/u);
    expect(() =>
      preprocessCs486C('#include "self.h"\n', {
        include: () => ({
          identity: "/work/main.c",
          source: '#include "self.h"\n',
          sourceName: "/work/main.c",
        }),
        sourceName: "/work/main.c",
      }),
    ).toThrow(/circular include/u);
    expect(() => raw("#pragma pack\n")).toThrow(
      /unsupported (?:preprocessor directive )?#pragma/u,
    );
    expect(() => raw("#define BAD(a, ..., b) 1\n")).toThrow(
      /variadic marker must end/u,
    );
    expect(() => raw("#line 0\nint x;\n")).toThrow(/positive line number/u);
  });

  it("bounds conditional, macro, include, and emitted-token work", (): void => {
    expect(cs486CPreprocessorLimits).toEqual({
      aggregateSourceCharacters: 2 * 1_048_576,
      emittedTokens: 512_000,
      rootSourceCharacters: 2 * 1_048_576,
    });
    expect(() => raw(`${"#if 1\n".repeat(65)}int x;\n`)).toThrow(
      /conditional nesting limit/u,
    );
    const macroChain = Array.from(
      { length: 66 },
      (_unused, index) => `#define M${String(index)} M${String(index + 1)}`,
    ).join("\n");
    expect(() =>
      raw(`${macroChain}\n#define M66 1\nint main(){return M0;}\n`),
    ).toThrow(/macro expansion depth limit/u);

    const include = (depth: number): Cs486CPreprocessorInclude => ({
      identity: `/work/${String(depth)}.h`,
      source: `#include "${String(depth + 1)}.h"\n`,
      sourceName: `/work/${String(depth)}.h`,
    });
    expect(() =>
      preprocessCs486C('#include "1.h"\n', {
        include: ({ path }) => include(Number.parseInt(path, 10)),
        sourceName: "/work/main.c",
      }),
    ).toThrow(/include depth limit/u);

    expect(() =>
      raw(`#define MANY ${"1 ".repeat(2_049)}\nint main(){return 0;}\n`),
    ).toThrow(/macro replacement limit/u);

    const doublingMacros = Array.from(
      { length: 19 },
      (_unused, index) =>
        `#define D${String(index + 1)} D${String(index)} D${String(index)}`,
    ).join("\n");
    expect(() =>
      raw(`#define D0 1\n${doublingMacros}\nint x = D19;\n`),
    ).toThrow(/macro expansion token limit/u);
  });
});
