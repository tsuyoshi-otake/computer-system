import { describe, expect, it } from "vitest";

import {
  dosTextUtilityLimits,
  executeDosComp,
  executeDosFc,
  executeDosFind,
  executeDosSort,
  parseDosChoice,
  parseDosPause,
} from "../../src/application/os/dosTextUtilities.js";

describe("bounded CS-DOS 6.x text utilities", (): void => {
  it("filters standard input and explicitly named guest files with FIND options", (): void => {
    const stdin = executeDosFind(
      ["/I", "/N", "alpha"],
      "Alpha\r\nbeta\r\nALPHA\r\n",
      (): string => {
        throw new Error("unexpected file read");
      },
    );
    expect(stdin).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "1:Alpha\r\n3:ALPHA\r\n",
    });

    const count = executeDosFind(
      ["/C", "/V", "skip", "C:\\LOG.TXT"],
      "",
      (path): string => {
        expect(path).toBe("C:\\LOG.TXT");
        return "keep\r\nskip\r\nkeep\r\n";
      },
    );
    expect(count).toEqual({ exitCode: 0, stderr: "", stdout: "2\r\n" });

    expect(
      executeDosFind(["needle", "*.TXT"], "", (): string => ""),
    ).toMatchObject({
      exitCode: 2,
      stderr: "FIND: Wildcards are unavailable.\r\n",
    });
    expect(
      executeDosFind(
        ["needle"],
        "x".repeat(dosTextUtilityLimits.maximumFindInputBytes + 1),
        (): string => "",
      ),
    ).toMatchObject({
      exitCode: 2,
      stderr: "FIND: Input limit exceeded.\r\n",
    });
  });

  it("sorts the bounded guest input deterministically with DOS switches", (): void => {
    const sorted = executeDosSort(
      ["/+2"],
      "b-z\r\nA-a\r\nc-b\r\n",
      (): string => "",
    );
    expect(sorted).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "A-a\r\nc-b\r\nb-z\r\n",
    });

    const reverse = executeDosSort(
      ["/R", "C:\\DATA.TXT"],
      "",
      (path): string => {
        expect(path).toBe("C:\\DATA.TXT");
        return "a\r\nC\r\nb\r\n";
      },
    );
    expect(reverse.stdout).toBe("C\r\nb\r\na\r\n");

    expect(
      executeDosSort(
        [],
        "x".repeat(dosTextUtilityLimits.maximumSortInputBytes + 1),
        (): string => "",
      ),
    ).toMatchObject({
      exitCode: 2,
      stderr: "SORT: Input exceeds 64 KiB.\r\n",
    });
  });

  it("compares text and bytes without a host comparison utility", (): void => {
    const files = new Map([
      ["C:\\LEFT.TXT", "one\r\ntwo\r\n"],
      ["C:\\RIGHT.TXT", "one\r\nTWO\r\n"],
    ]);
    const fc = executeDosFc(
      ["/C", "C:\\LEFT.TXT", "C:\\RIGHT.TXT"],
      (path): string => files.get(path) ?? "",
      (): Uint8Array => new Uint8Array(),
    );
    expect(fc).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "FC: no differences encountered\r\n",
    });

    const bytes = new Map([
      ["C:\\LEFT.BIN", Uint8Array.of(0x41, 0x42)],
      ["C:\\RIGHT.BIN", Uint8Array.of(0x41, 0x43)],
    ]);
    const comp = executeDosComp(
      ["/D", "C:\\LEFT.BIN", "C:\\RIGHT.BIN"],
      (path): Uint8Array => bytes.get(path) ?? new Uint8Array(),
    );
    expect(comp).toEqual({
      exitCode: 1,
      stderr: "",
      stdout: "1: 42 43\r\n",
    });

    const binaryFc = executeDosFc(
      ["/B", "C:\\LEFT.BIN", "C:\\RIGHT.BIN"],
      (): string => "",
      (path): Uint8Array => bytes.get(path) ?? new Uint8Array(),
    );
    expect(binaryFc.exitCode).toBe(1);
    expect(binaryFc.stdout).toContain("00000001: 42 43\r\n");
  });

  it("parses bounded CHOICE and PAUSE prompts before terminal ownership begins", (): void => {
    expect(parseDosChoice(["/C:YN", "Continue"])).toEqual({
      caseSensitive: false,
      choices: ["Y", "N"],
      display: "Continue [Y,N]?",
      kind: "choice",
    });
    expect(parseDosChoice(["/C:YY"])).toMatchObject({
      exitCode: 2,
      stderr:
        "CHOICE: choices must be 1 through 16 distinct letters or digits\r\n",
    });
    expect(parseDosPause([])).toEqual({
      display: "Press any key to continue . . .",
      kind: "pause",
    });
  });
});
