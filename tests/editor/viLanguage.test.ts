import { describe, expect, it } from "vitest";

import {
  indexViDocument,
  lexViLine,
  maximumViIndexedSymbols,
  maximumViIndexedWords,
  resolveViFiletype,
} from "../../src/application/editor/viLanguage.js";

describe("vi lightweight language services", (): void => {
  it("detects C, C++, Python, and CS assembly", (): void => {
    expect(resolveViFiletype("auto", "main.c")).toBe("c");
    expect(resolveViFiletype("auto", "main.hpp")).toBe("cpp");
    expect(resolveViFiletype("auto", "tool.py")).toBe("python");
    expect(resolveViFiletype("auto", "boot.asm")).toBe("asm");
    expect(resolveViFiletype("auto", undefined, "#!/usr/bin/python3")).toBe(
      "python",
    );
  });

  it("lexes incomplete multiline C and Python without throwing", (): void => {
    const comment = lexViLine("c", "/* unfinished", 80);
    expect(comment.state.multiline).toBe("c-comment");
    expect(
      lexViLine("c", "finished */ int value;", 80, comment.state).tokens,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "comment" }),
        expect.objectContaining({ kind: "keyword" }),
      ]),
    );
    const string = lexViLine("python", '"""unfinished', 80);
    expect(string.state.multiline).toBe("python-double");
    expect(() =>
      lexViLine("python", "still open", 80, string.state),
    ).not.toThrow();
  });

  it("indexes functions, types, macros, labels, and direct includes within caps", (): void => {
    const c = indexViDocument(
      "cpp",
      "/main.cpp",
      '#include "demo.hpp"\n#define LIMIT 4\nstruct Item {};\nint run() {',
    );
    expect(c.includes).toEqual([{ authored: "demo.hpp", kind: "quoted" }]);
    expect(c.symbols.map(({ name }) => name)).toEqual(["LIMIT", "Item", "run"]);
    const asm = indexViDocument(
      "asm",
      "/boot.asm",
      '%include "macros.inc"\nstart:\nCOUNT equ 4\n mov eax, COUNT',
    );
    expect(asm.symbols.map(({ name }) => name)).toEqual(["start", "COUNT"]);
    const large = indexViDocument(
      "python",
      "/large.py",
      Array.from(
        { length: 3_000 },
        (_, index) => `def item_${String(index)}(): pass`,
      ).join("\n"),
    );
    expect(large.words.length).toBeLessThanOrEqual(maximumViIndexedWords);
    expect(large.symbols).toHaveLength(maximumViIndexedSymbols);
  });
});
