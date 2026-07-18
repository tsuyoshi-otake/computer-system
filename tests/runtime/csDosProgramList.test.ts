import { describe, expect, it } from "vitest";

import {
  fingerprintCsDosProgram,
  parseCsDosProgramList,
} from "../../src/application/toolchain/csDosProgramList.js";

describe("CS-DOS Program List", (): void => {
  const source = [
    "CS PROGRAM LIST 1.0",
    "SOURCE=MAIN.C",
    "SOURCE=UTIL.CPP",
    "SOURCE=VIDEO.ASM",
    "OBJECT=VENDOR.OBJ",
    "INCLUDE=C:\\INCLUDE",
    "DEFINE=FEATURE=1",
    "UNDEF=OLD",
    "ENTRY=main",
    "OUTPUT=DEMO.CSX",
    "LISTING=DEMO.LST",
    "MAP=DEMO.MAP",
  ].join("\r\n");

  it("parses a bounded mixed-language list and deterministic options", (): void => {
    expect(parseCsDosProgramList(source)).toEqual({
      definitions: [{ name: "FEATURE", replacement: "1" }],
      entry: "main",
      includePaths: ["C:\\INCLUDE"],
      listingPath: "DEMO.LST",
      mapPath: "DEMO.MAP",
      objectPaths: ["VENDOR.OBJ"],
      outputPath: "DEMO.CSX",
      sources: [
        { language: "c", path: "MAIN.C" },
        { language: "cpp", path: "UTIL.CPP" },
        { language: "asm", path: "VIDEO.ASM" },
      ],
      undefines: ["OLD"],
    });
  });

  it("fingerprints compiler identity, ordered inputs, contents, and options", (): void => {
    const program = parseCsDosProgramList(source);
    const first = fingerprintCsDosProgram(program, [
      { contents: "A", path: "MAIN.C" },
      { contents: "B", path: "UTIL.CPP" },
    ]);
    expect(first).toBe(
      fingerprintCsDosProgram(program, [
        { contents: "A", path: "main.c" },
        { contents: "B", path: "util.cpp" },
      ]),
    );
    expect(first).not.toBe(
      fingerprintCsDosProgram(program, [
        { contents: "A", path: "MAIN.C" },
        { contents: "changed", path: "UTIL.CPP" },
      ]),
    );
  });

  it("rejects duplicates, collisions, unknown keys, and capacity plus one", (): void => {
    expect(() =>
      parseCsDosProgramList(
        "CS PROGRAM LIST 1.0\nSOURCE=A.C\nSOURCE=a.c\nOUTPUT=A.CSX",
      ),
    ).toThrow(/duplicate Program List input/u);
    expect(() =>
      parseCsDosProgramList(
        "CS PROGRAM LIST 1.0\nSOURCE=A.C\nSOURCE=DIR\\A.CPP\nOUTPUT=X.CSX",
      ),
    ).toThrow(/same-basename OBJ collision/u);
    expect(() =>
      parseCsDosProgramList("CS PROGRAM LIST 1.0\nSOURCE=A.C\nOUTPUT=A.C"),
    ).toThrow(/collides with an authored input/u);
    expect(() =>
      parseCsDosProgramList(
        "CS PROGRAM LIST 1.0\nSOURCE=A.C\nOBJECT=A.OBJ\nOUTPUT=A.CSX",
      ),
    ).toThrow(/generated OBJ/u);
    expect(() =>
      parseCsDosProgramList(
        "CS PROGRAM LIST 1.0\nSOURCE=A.C\nOUTPUT=X.CSX\nLISTING=x.csx",
      ),
    ).toThrow(/generated output paths collide/u);
    expect(() =>
      parseCsDosProgramList("CS PROGRAM LIST 1.0\nSOURCE=A.C\nOUTPUT=A.OBJ"),
    ).toThrow(/generated OBJ/u);
    expect(() =>
      parseCsDosProgramList(
        "CS PROGRAM LIST 1.0\nSOURCE=A.C\nPROJECT=OTHER.CSP\nOUTPUT=A.CSX",
      ),
    ).toThrow(/unsupported Program List key PROJECT/u);
    expect(() =>
      parseCsDosProgramList(
        `CS PROGRAM LIST 1.0\n${Array.from(
          { length: 65 },
          (_unused, index) => `SOURCE=S${String(index)}.C`,
        ).join("\n")}\nOUTPUT=A.CSX`,
      ),
    ).toThrow(/source count limit/u);
  });
});
