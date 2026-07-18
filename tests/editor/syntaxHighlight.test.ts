import { describe, expect, it } from "vitest";

import {
  highlightLine,
  highlightLineWithState,
} from "../../src/application/editor/syntaxHighlight.js";

describe("vi syntax highlighting", (): void => {
  it("controls Python syntax and indent rainbow independently", (): void => {
    const source = "    if value == 42: # note";
    const plain = highlightLine("demo.py", source, 51, {
      rainbow: false,
      syntax: false,
    });
    expect(plain.every(({ background }) => background === 15)).toBe(true);
    expect(plain.every(({ foreground }) => foreground === 0)).toBe(true);

    const cells = highlightLine("demo.py", source, 51, {
      rainbow: true,
      syntax: true,
    });

    expect(cells.slice(0, 4).map(({ background }) => background)).toEqual([
      11, 11, 10, 10,
    ]);
    expect(cells.slice(4, 6).every(({ foreground }) => foreground === 10)).toBe(
      true,
    );
    expect(
      cells.some(
        ({ character, foreground }) => character === "4" && foreground === 1,
      ),
    ).toBe(true);
    const comment = cells.findIndex(({ character }) => character === "#");
    expect(
      cells.slice(comment).every(({ foreground }) => foreground === 13),
    ).toBe(true);
  });

  it("renders bounded list markers without enabling syntax or rainbow", (): void => {
    const cells = highlightLine("demo.py", "\tvalue  ", 12, {
      endOfLine: true,
      list: true,
      rainbow: false,
      syntax: false,
    });

    expect(cells.map(({ character }) => character).join("")).toBe("→value··$");
    expect(cells.every(({ background }) => background === 15)).toBe(true);
    expect(
      cells.every(({ foreground }) => foreground === 0 || foreground === 8),
    ).toBe(true);
  });

  it("caps work to the requested visible width", (): void => {
    const cells = highlightLine(
      "large.json",
      `"key": "${"x".repeat(10_000)}"`,
      40,
    );
    expect(cells).toHaveLength(40);
  });

  it("highlights C/C++ and CS assembly tokens", (): void => {
    const c = highlightLine("main.cpp", "#define LIMIT 4 // note", 40, {
      syntax: true,
    });
    expect(c[0]?.foreground).toBe(14);
    expect(c.find(({ character }) => character === "4")?.foreground).toBe(1);
    expect(
      c
        .slice(c.findIndex(({ character }) => character === "/"))
        .every(({ foreground }) => foreground === 13),
    ).toBe(true);

    const asm = highlightLine("boot.asm", "mov eax, 4 ; note", 40, {
      syntax: true,
    });
    expect(asm.slice(0, 3).every(({ foreground }) => foreground === 10)).toBe(
      true,
    );
    expect(asm.slice(4, 7).every(({ foreground }) => foreground === 12)).toBe(
      true,
    );
  });

  it("carries multiline state only through the supplied visible sequence", (): void => {
    const opened = highlightLineWithState("main.c", "/* open", 40, {
      syntax: true,
    });
    const continued = highlightLineWithState(
      "main.c",
      "still */ int value;",
      40,
      {
        lexState: opened.state,
        syntax: true,
      },
    );
    expect(opened.state.multiline).toBe("c-comment");
    expect(
      continued.cells.slice(0, 8).every(({ foreground }) => foreground === 13),
    ).toBe(true);
    expect(continued.state.multiline).toBeNull();
  });
});
