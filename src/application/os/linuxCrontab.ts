import { utf8ByteLength } from "../../domain/text/utf8.js";

export const linuxCrontabLimits = Object.freeze({
  maximumCommandBytes: 512,
  maximumEntries: 64,
  maximumFieldPatternBytes: 64,
  maximumTermsPerField: 32,
  maximumUserBytes: 32,
});

interface CronFieldRange {
  readonly maximum: number;
  readonly minimum: number;
}

const minuteRange = Object.freeze({ maximum: 59, minimum: 0 });
const hourRange = Object.freeze({ maximum: 23, minimum: 0 });
const dayOfMonthRange = Object.freeze({ maximum: 31, minimum: 1 });
const monthRange = Object.freeze({ maximum: 12, minimum: 1 });
const dayOfWeekRange = Object.freeze({ maximum: 7, minimum: 0 });

const crontabLineExpression =
  /^(\S+)[ \t]+(\S+)[ \t]+(\S+)[ \t]+(\S+)[ \t]+(\S+)[ \t]+(\S+)[ \t]+([\s\S]*)$/u;

export interface CronEntry {
  readonly lineNumber: number;
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly daysOfMonth: ReadonlySet<number>;
  /** Wildcard provenance; expansion alone cannot preserve DOM/DOW rules. */
  readonly dayOfMonthWildcard: boolean;
  readonly months: ReadonlySet<number>;
  readonly daysOfWeek: ReadonlySet<number>;
  /** Wildcard provenance; expansion alone cannot preserve DOM/DOW rules. */
  readonly dayOfWeekWildcard: boolean;
  readonly user: string;
  readonly command: string;
}

export interface ParsedCrontab {
  readonly entries: readonly CronEntry[];
  readonly warnings: readonly string[];
}

export interface VirtualCalendarFields {
  readonly minute: number;
  readonly hour: number;
  readonly dayOfMonth: number;
  readonly month: number;
  readonly dayOfWeek: number;
}

export function parseLinuxCrontab(text: string): ParsedCrontab {
  const entries: CronEntry[] = [];
  const warnings: string[] = [];
  const lines = text.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]!;
    const lineNumber = index + 1;
    const withoutLeadingSpace = rawLine.replace(/^[ \t]+/u, "");
    if (withoutLeadingSpace.length === 0 || withoutLeadingSpace.startsWith("#"))
      continue;

    if (entries.length >= linuxCrontabLimits.maximumEntries) {
      warnings.push(
        "crontab: entry capacity exceeded, remaining lines ignored",
      );
      break;
    }

    const entry = parseCrontabLine(withoutLeadingSpace, lineNumber);
    if (entry === undefined) {
      warnings.push(
        `line ${String(lineNumber)}: malformed crontab entry, skipped`,
      );
      continue;
    }
    entries.push(entry);
  }

  return { entries, warnings };
}

export function virtualCalendarFields(
  tick: number,
  ticksPerSecond: number,
): VirtualCalendarFields {
  const epochMilliseconds =
    Date.UTC(2000, 0, 1) + Math.floor((tick / ticksPerSecond) * 1000);
  const date = new Date(epochMilliseconds);
  return {
    dayOfMonth: date.getUTCDate(),
    dayOfWeek: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    month: date.getUTCMonth() + 1,
  };
}

export function cronEntryDue(
  entry: CronEntry,
  fields: VirtualCalendarFields,
): boolean {
  const dayOfMonthMatches = entry.daysOfMonth.has(fields.dayOfMonth);
  const dayOfWeekMatches = entry.daysOfWeek.has(fields.dayOfWeek);
  const dayMatches =
    entry.dayOfMonthWildcard || entry.dayOfWeekWildcard
      ? dayOfMonthMatches && dayOfWeekMatches
      : dayOfMonthMatches || dayOfWeekMatches;
  return (
    entry.minutes.has(fields.minute) &&
    entry.hours.has(fields.hour) &&
    entry.months.has(fields.month) &&
    dayMatches
  );
}

function parseCrontabLine(
  line: string,
  lineNumber: number,
): CronEntry | undefined {
  const match = crontabLineExpression.exec(line);
  if (match === null) return undefined;
  const minuteText = match[1]!;
  const hourText = match[2]!;
  const dayOfMonthText = match[3]!;
  const monthText = match[4]!;
  const dayOfWeekText = match[5]!;
  const userText = match[6]!;
  const command = match[7]!;

  const minutes = parseCronField(minuteText, minuteRange, false);
  const hours = parseCronField(hourText, hourRange, false);
  const daysOfMonth = parseCronField(dayOfMonthText, dayOfMonthRange, false);
  const months = parseCronField(monthText, monthRange, false);
  const daysOfWeek = parseCronField(dayOfWeekText, dayOfWeekRange, true);
  if (
    minutes === undefined ||
    hours === undefined ||
    daysOfMonth === undefined ||
    months === undefined ||
    daysOfWeek === undefined
  )
    return undefined;

  if (utf8ByteLength(userText) > linuxCrontabLimits.maximumUserBytes)
    return undefined;
  if (
    command.length === 0 ||
    utf8ByteLength(command) > linuxCrontabLimits.maximumCommandBytes
  )
    return undefined;

  return {
    command,
    dayOfMonthWildcard: dayOfMonthText.includes("*"),
    daysOfMonth,
    dayOfWeekWildcard: dayOfWeekText.includes("*"),
    daysOfWeek,
    hours,
    lineNumber,
    minutes,
    months,
    user: userText,
  };
}

function parseCronField(
  pattern: string,
  range: CronFieldRange,
  foldSevenToZero: boolean,
): Set<number> | undefined {
  if (utf8ByteLength(pattern) > linuxCrontabLimits.maximumFieldPatternBytes)
    return undefined;
  const terms = pattern.split(",");
  if (
    terms.length === 0 ||
    terms.length > linuxCrontabLimits.maximumTermsPerField
  )
    return undefined;

  const values = new Set<number>();
  for (const term of terms) {
    const expanded = expandCronTerm(term, range);
    if (expanded === undefined) return undefined;
    for (const value of expanded)
      values.add(foldSevenToZero && value === 7 ? 0 : value);
  }
  return values;
}

function expandCronTerm(
  term: string,
  range: CronFieldRange,
): number[] | undefined {
  const slashParts = term.split("/");
  if (slashParts.length > 2) return undefined;
  const base = slashParts[0]!;
  const stepText = slashParts[1];

  let step = 1;
  if (stepText !== undefined) {
    if (!isPlainInteger(stepText)) return undefined;
    step = Number(stepText);
    if (step < 1) return undefined;
  }

  if (base === "*") return expandRange(range.minimum, range.maximum, step);

  const dashParts = base.split("-");
  if (dashParts.length === 2) {
    const [lowText, highText] = dashParts as [string, string];
    if (!isPlainInteger(lowText) || !isPlainInteger(highText)) return undefined;
    const low = Number(lowText);
    const high = Number(highText);
    if (low > high || low < range.minimum || high > range.maximum)
      return undefined;
    return expandRange(low, high, step);
  }
  if (dashParts.length > 2) return undefined;

  // Only `*` and `a-b` accept a trailing `/n` step; a bare integer with a
  // step (e.g. `5/3`) is not a supported cron term.
  if (stepText !== undefined) return undefined;
  if (!isPlainInteger(base)) return undefined;
  const value = Number(base);
  if (value < range.minimum || value > range.maximum) return undefined;
  return [value];
}

function expandRange(low: number, high: number, step: number): number[] {
  const values: number[] = [];
  for (let value = low; value <= high; value += step) values.push(value);
  return values;
}

function isPlainInteger(value: string): boolean {
  return /^[0-9]+$/u.test(value);
}
