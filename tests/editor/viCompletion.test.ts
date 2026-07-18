import { describe, expect, it } from "vitest";

import {
  collectViCompletions,
  findViDefinition,
  maximumViCompletionCandidates,
} from "../../src/application/editor/viCompletion.js";
import type {
  ViDocumentIndex,
  ViSymbol,
} from "../../src/application/editor/viLanguage.js";
import { defaultViOptions } from "../../src/application/editor/viOptions.js";

describe("vi lightweight completion", (): void => {
  it("keeps the canonical source priority regardless of authored source order", (): void => {
    const current = document(
      [{ line: 2, text: "reCurrent" }],
      [symbol("reSymbol", "/main.py", 3)],
    );
    const buffer = document([{ line: 0, text: "reBuffer" }], []);
    const candidates = collectViCompletions(
      {
        ...defaultViOptions,
        completesources: [
          "includes",
          "keywords",
          "symbols",
          "buffers",
          "current",
        ],
      },
      "re",
      2,
      current,
      [{ index: buffer, path: "/visited.py" }],
      [{ contents: "def reInclude():\n  pass", path: "/included.py" }],
    );

    expect(candidates.slice(0, 5)).toEqual([
      { source: "current", text: "reCurrent" },
      { source: "buffers", text: "reBuffer" },
      { source: "symbols", text: "reSymbol" },
      { source: "keywords", text: "return" },
      { source: "includes", text: "reInclude" },
    ]);
  });

  it("applies smart case and stops at the candidate cap", (): void => {
    const current = document(
      [
        { line: 0, text: "alpha" },
        { line: 0, text: "Alpha" },
        ...Array.from({ length: 100 }, (_, index) => ({
          line: 1,
          text: `candidate_${String(index)}`,
        })),
      ],
      [],
    );
    expect(
      collectViCompletions(
        { ...defaultViOptions, completesources: ["current"] },
        "Al",
        0,
        current,
        [],
        [],
      ).map(({ text }) => text),
    ).toEqual(["Alpha"]);
    expect(
      collectViCompletions(
        {
          ...defaultViOptions,
          completecase: "insensitive",
          completesources: ["current"],
        },
        "ca",
        0,
        current,
        [],
        [],
      ),
    ).toHaveLength(maximumViCompletionCandidates);
  });

  it("finds definitions in current, visited, then opted-in include indexes", (): void => {
    const current = document([], [symbol("target", "/main.py", 1)]);
    const buffer = document([], [symbol("target", "/visited.py", 2)]);
    expect(
      findViDefinition(
        "target",
        current,
        [{ index: buffer, path: "/visited.py" }],
        [{ contents: "def target(): pass", path: "/included.py" }],
        {
          ...defaultViOptions,
          definitionsources: ["includes", "buffers", "current"],
        },
      )?.path,
    ).toBe("/main.py");
  });
});

function document(
  words: ViDocumentIndex["words"],
  symbols: ViDocumentIndex["symbols"],
): ViDocumentIndex {
  return { filetype: "python", includes: [], symbols, words };
}

function symbol(name: string, path: string, line: number): ViSymbol {
  return { column: 0, kind: "function", line, name, path };
}
