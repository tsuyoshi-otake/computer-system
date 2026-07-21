import { describe, expect, it } from "vitest";

import {
  entriesForRunlevel,
  LinuxInittabParseError,
  parseLinuxInittab,
} from "../../src/application/os/linuxInittab.js";

describe("Linux inittab parser", (): void => {
  it("parses a realistic inittab into entries, initDefault, and no warnings", (): void => {
    const text =
      [
        "si::sysinit:/etc/init.d/rcS",
        "id:3:initdefault:",
        "l3:2345:respawn:/sbin/getty 38400 tty1",
        "w1:3:wait:/etc/init.d/rc 3",
      ].join("\n") + "\n";

    const parsed = parseLinuxInittab(text);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.initDefault).toBe("3");
    expect(parsed.entries).toMatchObject([
      {
        action: "sysinit",
        id: "si",
        process: "/etc/init.d/rcS",
        runlevels: [],
      },
      { action: "initdefault", id: "id", process: "", runlevels: ["3"] },
      {
        action: "respawn",
        id: "l3",
        process: "/sbin/getty 38400 tty1",
        runlevels: ["2", "3", "4", "5"],
      },
      {
        action: "wait",
        id: "w1",
        process: "/etc/init.d/rc 3",
        runlevels: ["3"],
      },
    ]);
  });

  it("rejects a 65th substantive line with too_many_lines and no line attribution", (): void => {
    const lines: string[] = [];
    for (let index = 0; index < 65; index += 1) {
      lines.push(`${String(index).padStart(2, "0")}::sysinit:`);
    }
    const text = lines.join("\n") + "\n";

    expectInittabError(text, "too_many_lines", undefined);
  });

  it("rejects a line that does not split into exactly 4 fields", (): void => {
    const text = "id:3:initdefault:\nbroken-line-without-enough-colons\n";

    expectInittabError(text, "malformed_line", 2);
  });

  it("rejects an empty id field", (): void => {
    const text = "id:3:initdefault:\n:2345:respawn:/sbin/getty\n";

    expectInittabError(text, "empty_id", 2);
  });

  it("rejects an id exceeding 4 UTF-8 bytes, proving byte length not character length", (): void => {
    // "ああ" is 2 characters but 6 UTF-8 bytes, so this exercises byte counting.
    const text = "id:3:initdefault:\nああ:2345:respawn:/sbin/getty\n";

    expectInittabError(text, "id_too_long", 2);
  });

  it("rejects a duplicate id, attributing the fault to the second occurrence", (): void => {
    const text =
      "id:3:initdefault:\nl3:2345:respawn:/sbin/getty\nl3:3:wait:/bin/x\n";

    expectInittabError(text, "duplicate_id", 3);
  });

  it("rejects an invalid runlevel character", (): void => {
    const withDigitSeven = "id:3:initdefault:\nl3:2347:respawn:/sbin/getty\n";
    expectInittabError(withDigitSeven, "invalid_runlevel", 2);

    const withLowercaseS = "id:3:initdefault:\nl3:2s:respawn:/sbin/getty\n";
    expectInittabError(withLowercaseS, "invalid_runlevel", 2);
  });

  it("rejects a process field exceeding 512 UTF-8 bytes", (): void => {
    const text = `id:3:initdefault:\nl3:2345:respawn:${"x".repeat(513)}\n`;

    expectInittabError(text, "process_too_long", 2);
  });

  it("rejects a file with zero initdefault entries", (): void => {
    const text = "l3:2345:respawn:/sbin/getty\n";

    expectInittabError(text, "missing_initdefault", undefined);
  });

  it("rejects a file with two initdefault entries, attributing the second", (): void => {
    const text = "id:3:initdefault:\nid2:5:initdefault:\n";

    expectInittabError(text, "duplicate_initdefault", 2);
  });

  it("rejects an initdefault entry with empty or multi-character runlevels", (): void => {
    const emptyRunlevel = "id::initdefault:\n";
    expectInittabError(emptyRunlevel, "invalid_runlevel", 1);

    const multiRunlevel = "id:35:initdefault:\n";
    expectInittabError(multiRunlevel, "invalid_runlevel", 1);
  });

  it("skips an unknown action into warnings while the rest of the file still parses", (): void => {
    const text = "id:3:initdefault:\nfo:2:foo:/bin/something\n";

    const parsed = parseLinuxInittab(text);

    expect(parsed.entries).toMatchObject([{ action: "initdefault", id: "id" }]);
    expect(parsed.initDefault).toBe("3");
    expect(parsed.warnings).toEqual([
      'line 2: unknown inittab action "foo", entry ignored',
    ]);
  });

  it("ignores comments and blank lines without affecting the 64-line cap or line-number attribution", (): void => {
    const text = [
      "# leading comment",
      "",
      "broken-line-without-colons",
      "id2:3:initdefault:",
    ].join("\n");

    expectInittabError(text, "malformed_line", 3);
  });

  it("filters entries by runlevel and action via entriesForRunlevel", (): void => {
    const text =
      [
        "si::sysinit:/etc/init.d/rcS",
        "id:3:initdefault:",
        "l3:2345:respawn:/sbin/getty 38400 tty1",
        "l4:4:respawn:/sbin/getty 38400 tty2",
      ].join("\n") + "\n";
    const { entries } = parseLinuxInittab(text);

    const forRunlevel3 = entriesForRunlevel(entries, "3");
    expect(forRunlevel3.map((entry) => entry.id)).toEqual(["si", "id", "l3"]);

    const forRunlevel4 = entriesForRunlevel(entries, "4");
    expect(forRunlevel4.map((entry) => entry.id)).toEqual(["si", "l3", "l4"]);

    const respawnOnlyForRunlevel3 = entriesForRunlevel(entries, "3", "respawn");
    expect(respawnOnlyForRunlevel3.map((entry) => entry.id)).toEqual(["l3"]);

    const sysinitEntries = entriesForRunlevel(entries, "9", "sysinit");
    expect(sysinitEntries.map((entry) => entry.id)).toEqual(["si"]);
  });
});

function expectInittabError(
  text: string,
  code: string,
  line: number | undefined,
): void {
  try {
    parseLinuxInittab(text);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(LinuxInittabParseError);
    expect((error as LinuxInittabParseError).code).toBe(code);
    expect((error as LinuxInittabParseError).line).toBe(line);
    return;
  }
  throw new Error(`Expected LinuxInittabParseError with code ${code}`);
}
