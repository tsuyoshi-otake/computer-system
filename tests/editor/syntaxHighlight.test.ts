import { describe, expect, it } from "vitest";

import { highlightLine } from "../../src/application/editor/syntaxHighlight.js";

describe("vi syntax highlighting", (): void => {
  it("highlights Python tokens and enables indent rainbow by default", (): void => {
    const cells = highlightLine("demo.py", "    if value == 42: # note", 51);

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

  it("caps work to the requested visible width", (): void => {
    const cells = highlightLine(
      "large.json",
      `"key": "${"x".repeat(10_000)}"`,
      40,
    );
    expect(cells).toHaveLength(40);
  });
});
