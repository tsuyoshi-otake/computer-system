import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import {
  cronEntryDue,
  parseLinuxCrontab,
  virtualCalendarFields,
} from "../../src/application/os/linuxCrontab.js";

describe("Linux system crontab parser", (): void => {
  it("parses a realistic crontab with wildcard, exact, list, range, and step fields", (): void => {
    const parsed = parseLinuxCrontab(
      [
        "# system crontab",
        "",
        "* * * * * root /usr/bin/every-minute",
        "30 2 * * * root /usr/bin/nightly-backup",
        "0,15,30,45 * * * * cs /usr/bin/quarter-hour",
        "* 9-17 * * * cs /usr/bin/business-hours",
        "*/15 * * * * cs /usr/bin/step-quarter",
        "",
      ].join("\n"),
    );

    expect(parsed.warnings).toEqual([]);
    expect(parsed.entries).toHaveLength(5);

    const [everyMinute, nightly, quarterHour, businessHours, stepQuarter] =
      parsed.entries;
    expect(everyMinute).toMatchObject({ command: "/usr/bin/every-minute" });
    expect(nightly).toMatchObject({ command: "/usr/bin/nightly-backup" });

    expect(quarterHour!.minutes).toEqual(new Set([0, 15, 30, 45]));
    expect(businessHours!.hours).toEqual(
      new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]),
    );
    expect(stepQuarter!.minutes).toEqual(new Set([0, 15, 30, 45]));
  });

  it("records the physical 1-indexed line number for each entry", (): void => {
    const parsed = parseLinuxCrontab(
      [
        "# header comment",
        "",
        "* * * * * root /usr/bin/first",
        "# a comment between entries",
        "* * * * * root /usr/bin/second",
      ].join("\n"),
    );

    expect(parsed.warnings).toEqual([]);
    expect(parsed.entries.map((entry) => entry.lineNumber)).toEqual([3, 5]);
  });

  it("derives deterministic virtual calendar fields from tick and ticksPerSecond alone", (): void => {
    const epochFields = virtualCalendarFields(0, 20);
    expect(epochFields).toEqual({
      dayOfMonth: 1,
      dayOfWeek: 6,
      hour: 0,
      minute: 0,
      month: 1,
    });
    expect(new Date(Date.UTC(2000, 0, 1)).getUTCDay()).toBe(6);

    const repeated = virtualCalendarFields(0, 20);
    expect(repeated).toEqual(epochFields);

    const oneMinuteLater = virtualCalendarFields(20 * 60, 20);
    expect(oneMinuteLater.minute).toBe(1);
    expect(oneMinuteLater.hour).toBe(0);

    const fields = virtualCalendarFields(20 * 60 * 60 * 24 * 40, 20);
    expect(fields.month).toBeGreaterThanOrEqual(1);
    expect(fields.month).toBeLessThanOrEqual(12);
    expect(fields.dayOfWeek).toBeGreaterThanOrEqual(0);
    expect(fields.dayOfWeek).toBeLessThanOrEqual(6);
  });

  it("matches on day-of-month OR day-of-week when both are restricted from *", (): void => {
    const parsed = parseLinuxCrontab("0 0 15 * 1 root /usr/bin/or-semantics\n");
    const [entry] = parsed.entries;
    expect(entry).toBeDefined();

    const matchesByDayOfMonth = {
      dayOfMonth: 15,
      dayOfWeek: 3,
      hour: 0,
      minute: 0,
      month: 6,
    };
    expect(cronEntryDue(entry!, matchesByDayOfMonth)).toBe(true);

    const matchesByDayOfWeek = {
      dayOfMonth: 20,
      dayOfWeek: 1,
      hour: 0,
      minute: 0,
      month: 6,
    };
    expect(cronEntryDue(entry!, matchesByDayOfWeek)).toBe(true);

    const matchesNeither = {
      dayOfMonth: 20,
      dayOfWeek: 3,
      hour: 0,
      minute: 0,
      month: 6,
    };
    expect(cronEntryDue(entry!, matchesNeither)).toBe(false);
  });

  it("does not let wildcard DOW make every DOM due", (): void => {
    const entry = parseLinuxCrontab("0 0 15 * * root /usr/bin/monthly\n")
      .entries[0]!;
    expect(
      cronEntryDue(entry, {
        dayOfMonth: 20,
        dayOfWeek: 3,
        hour: 0,
        minute: 0,
        month: 6,
      }),
    ).toBe(false);
  });

  it("skips a line with fewer than 7 whitespace-separated tokens", (): void => {
    const parsed = parseLinuxCrontab(
      ["0 0 * * * root", "* * * * * root /usr/bin/valid"].join("\n"),
    );

    expect(parsed.warnings).toEqual([
      "line 1: malformed crontab entry, skipped",
    ]);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]!.command).toBe("/usr/bin/valid");
  });

  it("skips lines with an out-of-range numeric field", (): void => {
    const cases = [
      "60 0 * * * root /usr/bin/bad-minute",
      "0 24 * * * root /usr/bin/bad-hour",
      "0 0 * 13 * root /usr/bin/bad-month",
      "0 0 * * 8 root /usr/bin/bad-dow",
    ];
    for (const line of cases) {
      const parsed = parseLinuxCrontab(`${line}\n`);
      expect(parsed.entries).toHaveLength(0);
      expect(parsed.warnings).toEqual([
        "line 1: malformed crontab entry, skipped",
      ]);
    }
  });

  it("skips a line with a > b in a range", (): void => {
    const parsed = parseLinuxCrontab("0 17-9 * * * root /usr/bin/bad-range\n");
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.warnings).toEqual([
      "line 1: malformed crontab entry, skipped",
    ]);
  });

  it("skips a line with a step of 0", (): void => {
    const parsed = parseLinuxCrontab("*/0 * * * * root /usr/bin/bad-step\n");
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.warnings).toEqual([
      "line 1: malformed crontab entry, skipped",
    ]);
  });

  it("skips a line with more than 32 comma-separated terms in a field", (): void => {
    const minutes = Array.from({ length: 33 }, (_, index) => index).join(",");
    const parsed = parseLinuxCrontab(
      `${minutes} * * * * root /usr/bin/too-many\n`,
    );
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.warnings).toEqual([
      "line 1: malformed crontab entry, skipped",
    ]);
  });

  it("skips a line with an oversized field pattern (> 64 bytes)", (): void => {
    const oversizedField = Array.from({ length: 40 }, (_, index) =>
      String(index % 10),
    ).join(",");
    const parsed = parseLinuxCrontab(
      `${oversizedField} 0 * * * root /usr/bin/oversized-field\n`,
    );
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.warnings).toEqual([
      "line 1: malformed crontab entry, skipped",
    ]);
  });

  it("skips a line with an oversized user (> 32 UTF-8 bytes)", (): void => {
    const oversizedUser = "u".repeat(33);
    const parsed = parseLinuxCrontab(
      `* * * * * ${oversizedUser} /usr/bin/oversized-user\n`,
    );
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.warnings).toEqual([
      "line 1: malformed crontab entry, skipped",
    ]);
  });

  it("skips a line with an oversized command (> 512 UTF-8 bytes)", (): void => {
    const oversizedCommand = `/usr/bin/${"x".repeat(510)}`;
    const parsed = parseLinuxCrontab(`* * * * * root ${oversizedCommand}\n`);
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.warnings).toEqual([
      "line 1: malformed crontab entry, skipped",
    ]);
  });

  it("skips a line with an empty command", (): void => {
    const parsed = parseLinuxCrontab("* * * * * root \n");
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.warnings).toEqual([
      "line 1: malformed crontab entry, skipped",
    ]);
  });

  it("folds a bare 7 and a range crossing 7 to 0 in the resulting dayOfWeek set", (): void => {
    const parsed = parseLinuxCrontab(
      [
        "0 0 * * 7 root /usr/bin/bare-seven",
        "0 0 * * 5-7 root /usr/bin/range-seven",
      ].join("\n"),
    );

    expect(parsed.warnings).toEqual([]);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]!.daysOfWeek).toEqual(new Set([0]));
    expect(parsed.entries[1]!.daysOfWeek).toEqual(new Set([0, 5, 6]));
  });

  it("caps valid entries at 64 and emits a single capacity warning", (): void => {
    const lines = Array.from(
      { length: 65 },
      (_, index) => `* * * * * root /usr/bin/job-${String(index)}`,
    );
    const parsed = parseLinuxCrontab(lines.join("\n") + "\n");

    expect(parsed.entries).toHaveLength(64);
    expect(parsed.warnings).toEqual([
      "crontab: entry capacity exceeded, remaining lines ignored",
    ]);
    expect(parsed.entries[63]!.command).toBe("/usr/bin/job-63");
  });

  it("does not count comments or blanks toward the entry cap or emit warnings for them", (): void => {
    const parsed = parseLinuxCrontab(
      [
        "# comment one",
        "",
        "   ",
        "# comment two",
        "* * * * * root /usr/bin/only-entry",
      ].join("\n"),
    );

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.entries[0]!.lineNumber).toBe(5);
  });
});

describe("crontab system-file wrapper", (): void => {
  it("lists the global system crontab", (): void => {
    const filesystem = new InMemoryFilesystem();
    const session = new ShellSession(filesystem, { osProfile: "linux" });

    const result = session.submit("crontab -l");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("/etc/crontab: system crontab");
  });

  it("requires a durable root shell for editing", (): void => {
    const filesystem = new InMemoryFilesystem();
    const session = new ShellSession(filesystem, { osProfile: "linux" });

    const result = session.submit("crontab -e");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("requires a root login shell");
  });

  it("runs at most one cached system-crontab job per virtual minute", (): void => {
    const filesystem = new InMemoryFilesystem();
    let tick = 0;
    const session = new ShellSession(filesystem, {
      currentTick: (): number => tick,
      osProfile: "linux",
    });
    filesystem.writeFile(
      "/etc/crontab",
      "* * * * * root echo hit >> /tmp/cron.log\n",
    );

    tick = 1;
    session.advanceSystemServices(tick);
    session.advanceSystemServices(tick + 1);
    expect(filesystem.readFile("/tmp/cron.log")).toBe("hit\n");

    filesystem.writeFile(
      "/etc/crontab",
      "* * * * * root echo changed >> /tmp/cron.log\n",
    );
    tick = 20 * 60;
    session.advanceSystemServices(tick);
    expect(filesystem.readFile("/tmp/cron.log")).toBe("hit\nhit\n");
  });
});
