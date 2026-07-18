import { describe, expect, it } from "vitest";

import {
  maximumTuiVerificationLiterals,
  verifyTuiScreen,
} from "../../tools/tui-screen-verifier.mjs";

function screen(options = {}) {
  const rows = options.rows ?? [
    "\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510",
    "\u2502File      \u2502",
    "\u2502Open Save \u2502",
    "\u2502OK  Help  \u2502",
    "\u2502          \u2502",
    "\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518",
  ];
  const width = [...rows[0]].length;
  const colors = Array.from({ length: rows.length }, () =>
    Array.from({ length: width }, () => 8),
  );
  return {
    schema: 1,
    computerId: "c-000001",
    sessionId: "session-1",
    principalKind: "debug",
    mode: "writer",
    snapshotVersion: options.snapshotVersion ?? 3,
    surface: {
      kind: "text",
      schema: 1,
      width,
      height: rows.length,
      rows,
      cursor: { blink: true, x: 2, y: 2 },
      secretInput: false,
      ...(options.includeColors === false
        ? {}
        : { foreground: colors, background: colors }),
    },
  };
}

describe("MCP TUI screen verifier", () => {
  it("returns bounded evidence for geometry, literals, colors, and vertical runs", () => {
    const result = verifyTuiScreen(screen(), {
      width: 12,
      height: 6,
      minimumVersion: 3,
      containsAll: ["File", "Help"],
      excludesAll: ["Error"],
      orderedContains: ["File", "Open", "OK"],
      sameRowGroups: [
        ["Open", "Save"],
        ["OK", "Help"],
      ],
      verticalRuns: [
        { characters: "\u2502", minimumLength: 4, minimumCount: 2 },
      ],
    });

    expect(result).toMatchObject({
      verified: true,
      exactDebugWriter: true,
      snapshotVersion: 3,
      surface: {
        width: 12,
        height: 6,
        rowCount: 6,
        cursorValid: true,
        colorGridsValid: true,
      },
      checks: {
        containsAll: 2,
        excludesAll: 1,
        orderedContains: 3,
        sameRowGroups: 2,
        verticalRuns: [
          { count: 2, longest: 4, minimumCount: 2, minimumLength: 4 },
        ],
      },
      failures: [],
    });
    expect(result).not.toHaveProperty("rows");
    expect(result.surface).not.toHaveProperty("rows");
  });

  it("returns explicit mismatch reasons without returning captured text", () => {
    const result = verifyTuiScreen(screen(), {
      width: 80,
      minimumVersion: 4,
      containsAll: ["Missing"],
      excludesAll: ["File"],
      orderedContains: ["Help", "Open"],
      sameRowGroups: [["File", "Help"]],
      verticalRuns: [
        { characters: "\u2502", minimumLength: 5, minimumCount: 1 },
      ],
    });

    expect(result.verified).toBe(false);
    expect(result.failures).toEqual([
      "width expected 80 but received 12",
      "snapshotVersion expected at least 4 but received 3",
      "containsAll[0] was not found",
      "excludesAll[0] was found",
      "orderedContains[1] was not found in order",
      "sameRowGroups[0] was not found on one row",
      "verticalRuns[0] expected 1 run(s) of length 5 but found 0",
    ]);
    expect(JSON.stringify(result)).not.toContain("File");
  });

  it("allows contract checks without color grids when explicitly requested", () => {
    expect(
      verifyTuiScreen(screen({ includeColors: false }), {
        requireColors: false,
      }),
    ).toMatchObject({
      verified: true,
      surface: { colorGridsValid: null },
    });
  });

  it("rejects malformed or capacity-plus-one verification criteria", () => {
    expect(() =>
      verifyTuiScreen(screen(), {
        containsAll: Array.from(
          { length: maximumTuiVerificationLiterals + 1 },
          () => "x",
        ),
      }),
    ).toThrow(/at most 32/u);
    expect(() =>
      verifyTuiScreen(screen(), {
        verticalRuns: [{ characters: "|", minimumLength: 0 }],
      }),
    ).toThrow(/minimumLength/u);
    expect(() => verifyTuiScreen(screen({ includeColors: false }), {})).toThrow(
      /foreground color grid/u,
    );
  });
});
