export interface LinuxManualPage {
  readonly description: readonly string[];
  readonly name: string;
  readonly section: 1 | 5 | 7 | 8;
  readonly seeAlso: readonly string[];
  readonly synopsis: readonly string[];
  readonly summary: string;
}

const pages = Object.freeze([
  page(
    "cs-linux",
    7,
    "state-backed CS-Linux operating environment",
    ["man COMMAND", "apropos WORD"],
    [
      "CS-Linux exposes one bounded guest operating-system state per Computer.",
      "Processes, login sessions, services, mounts, devices, journal records, and shutdown phases are derived from that state rather than host processes or decorative output.",
      "The shell and every documented utility remain sandboxed inside the Computer filesystem.",
    ],
    ["ps", "service", "dmesg", "shutdown"],
  ),
  page(
    "apropos",
    1,
    "search installed manual page names and summaries",
    ["apropos WORD"],
    [
      "Search is case-insensitive, literal, and bounded to the installed versioned manual index.",
    ],
    ["man"],
  ),
  page(
    "bg",
    1,
    "continue a supported job in the background",
    ["bg [JOB]"],
    [
      "Resume a stopped bounded job. JOB is a job number such as %1 or an unambiguous process ID.",
    ],
    ["fg", "jobs", "kill", "wait"],
  ),
  page(
    "dmesg",
    8,
    "print the authoritative boot-scoped kernel journal",
    ["dmesg"],
    [
      "Print kernel and device events which actually occurred during this boot. The ring has fixed entry and byte limits.",
    ],
    ["service", "ps"],
  ),
  page(
    "fg",
    1,
    "bring a supported job to the foreground",
    ["fg [JOB]"],
    [
      "Continue the selected job and wait for its terminal result. TUI, secret-prompt, lifecycle, and unsupported pipeline jobs are never admitted in the background.",
    ],
    ["bg", "jobs", "wait"],
  ),
  page(
    "jobs",
    1,
    "list jobs owned by the current login shell",
    ["jobs"],
    [
      "Display bounded job numbers, process IDs, state, and command names from the OS job table.",
    ],
    ["bg", "fg", "ps", "wait"],
  ),
  page(
    "kill",
    1,
    "send a bounded guest signal to a process",
    ["kill [-s SIGNAL] PID ...", "kill -SIGNAL PID ..."],
    [
      "Supported signals are HUP, INT, TERM, KILL, STOP, and CONT. Permission checks use the caller's captured guest credentials; no host process is addressed.",
    ],
    ["jobs", "ps", "wait"],
  ),
  page(
    "last",
    1,
    "show retained login-session history",
    ["last"],
    [
      "Display bounded completed and active login records, including tty, login time, logout reason, and prior-login information. Password input is never recorded.",
    ],
    ["tty", "w", "who"],
  ),
  page(
    "man",
    1,
    "display an installed CS-Linux manual page",
    ["man TOPIC"],
    [
      "Pages come from the same versioned command metadata shipped with the OS image. This command does not access the Internet or host manual database.",
    ],
    ["apropos", "cs-linux"],
  ),
  page(
    "ps",
    1,
    "report guest process state",
    ["ps", "ps -f", "ps -e"],
    [
      "Read PID, PPID, credentials, state, wait reason, modeled CPU cycles, start tick, and command from the bounded OS process table.",
    ],
    ["kill", "top", "jobs"],
  ),
  page(
    "service",
    8,
    "inspect real CS-Linux service state",
    ["service --status-all", "service NAME status"],
    [
      "Service mutation is owned by cs-init and is not exposed by this status-only command. CS-Linux does not imitate systemd.",
    ],
    ["dmesg", "ps"],
  ),
  page(
    "top",
    1,
    "print one bounded process-table snapshot",
    ["top"],
    [
      "Render a non-interactive summary of load and the current process table. It never opens an unbounded refresh loop.",
    ],
    ["ps", "w"],
  ),
  page(
    "tty",
    1,
    "print the current login terminal",
    ["tty"],
    ["Print the tty assigned to the authenticated OS login session."],
    ["last", "who"],
  ),
  page(
    "w",
    1,
    "show active users and their guest activity",
    ["w"],
    [
      "Combine active login sessions with their shell or foreground process state.",
    ],
    ["last", "ps", "who"],
  ),
  page(
    "wait",
    1,
    "wait for a supported child job",
    ["wait [JOB|PID]"],
    [
      "Wait for one owned job, or all owned jobs when no operand is supplied. Completed status comes from the authoritative process record.",
    ],
    ["jobs", "fg"],
  ),
  page(
    "who",
    1,
    "show active login sessions",
    ["who"],
    ["List authenticated sessions from the bounded OS login-session table."],
    ["last", "tty", "w"],
  ),
] satisfies readonly LinuxManualPage[]);

const pagesByName = new Map(pages.map((entry) => [entry.name, entry] as const));

export function linuxManualPage(name: string): LinuxManualPage | undefined {
  return pagesByName.get(name.toLowerCase());
}

export function linuxManualPages(): readonly LinuxManualPage[] {
  return pages;
}

export function renderLinuxManualPage(entry: LinuxManualPage): string {
  const heading = entry.name.toUpperCase();
  return [
    `${heading}(${String(entry.section)})`,
    "",
    "NAME",
    `    ${entry.name} - ${entry.summary}`,
    "",
    "SYNOPSIS",
    ...entry.synopsis.map((line) => `    ${line}`),
    "",
    "DESCRIPTION",
    ...entry.description.map((line) => `    ${line}`),
    "",
    "SEE ALSO",
    `    ${entry.seeAlso.join(", ")}`,
    "",
  ].join("\n");
}

function page(
  name: string,
  section: LinuxManualPage["section"],
  summary: string,
  synopsis: readonly string[],
  description: readonly string[],
  seeAlso: readonly string[],
): LinuxManualPage {
  return Object.freeze({
    description: Object.freeze([...description]),
    name,
    section,
    seeAlso: Object.freeze([...seeAlso]),
    synopsis: Object.freeze([...synopsis]),
    summary,
  });
}
