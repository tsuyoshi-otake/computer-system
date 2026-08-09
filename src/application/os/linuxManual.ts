export interface LinuxManualPage {
  readonly description: readonly string[];
  readonly name: string;
  readonly section: 1 | 5 | 6 | 7 | 8;
  readonly seeAlso: readonly string[];
  readonly synopsis: readonly string[];
  readonly summary: string;
}

const pages = Object.freeze([
  page(
    "cs-linux",
    7,
    "state-backed CS-Linux operating environment",
    ["man COMMAND", "COMMAND [REDIRECT ...] [| COMMAND ...]", "apropos WORD"],
    [
      "CS-Linux exposes one bounded guest operating-system state per Computer.",
      "Processes, login sessions, services, mounts, devices, journal records, and shutdown phases are derived from that state rather than host processes or decorative output.",
      "The shell and every documented utility remain sandboxed inside the Computer filesystem.",
      "The shell exposes standard input (stdin, descriptor 0), standard output (stdout, descriptor 1), and standard error (stderr, descriptor 2). At an ordinary terminal all three begin at the terminal; stdout carries normal results and stderr carries diagnostics.",
      "A foreground pipeline runs each stage as a scheduler-owned guest process joined by a fixed 4 KiB byte ring. | connects stdout to the next stage's stdin, |& connects stdout and stderr, the last stage supplies pipeline status, and a writer whose final reader closes terminates with SIGPIPE status 141. pipefail and background pipelines are unavailable.",
      "Redirects are applied from left to right. Supported forms are <, >, >>, 2>, 2>>, 2>&1, and &>; therefore probe >all 2>&1 or probe &>all combines both streams while probe 2>&1 >out leaves duplicated stderr on the previous stdout. Setup is validated and committed before execution, > and &> truncate at shell-open time, and at most 16 redirect operations are accepted per stage. tee writes pipeline stdout to both the terminal and a guest file.",
      "A literal here-document, such as cat <<EOF followed by lines and a terminating EOF, supplies descriptor 0 without a file. A submitted terminal command must end at its terminator; scripts resume at the following line. Each command accepts at most eight here-documents and 64 KiB of their UTF-8 content. Unsupported syntax fails before guest command execution.",
    ],
    ["ps", "service", "dmesg", "shutdown"],
  ),
  page(
    "nethack",
    6,
    "play the reduced deterministic CS-Linux dungeon game",
    ["nethack [--help|--version]"],
    [
      "NetHack for CS-Linux is a reduced guest-authored CS C 2.0 game with ten dungeon levels, the Amulet of Yendor, bounded monsters and items, hunger, experience, and explored-tile memory. It is not an unmodified upstream NetHack port.",
      "Move with h, j, k, l, y, u, b, and n. Items remain on the floor until , picks them up. The 80 by 25 inventory and selectors preserve fixed a-p slots: i displays the pack, e eats, q quaffs, r reads, w wields (w- unwields), W wears armor, T takes armor off, and d drops a stack. ? or * redisplays a selector and Esc cancels without spending a turn. Use < and > only on legal stairs, ? for the in-game key help screen, S to save and exit, and the complete #quit command to abandon unsaved progress. The bottom status line always shows Dlvl, HP, Lv, XP, turn count, hunger stage, and Amulet possession. Only successful world mutations consume a turn; display, cancel, invalid selection, and rejected capacity changes do not.",
      "The save path is the immutable launch environment's $HOME/.nethack.sav. Version 3 records retain fixed inventory slots, stack quantities, and equipped weapon and armor, while exact version 2 records remain loadable and migrate on the next explicit save. A record is fully validated before live state changes. A successful save writes a mode-0600 sibling temporary file and atomically replaces the canonical record. Missing HOME, malformed saves, DAC denial, capacity failure, interruption, and terminal close fail without silently saving.",
      "The stock root-owned executable is /usr/games/nethack. Sources and an explicit-rule Makefile are under /usr/src/nethack. A writable copy can be rebuilt with guest make, cc, and ld; make install PREFIX=/usr/local installs /usr/local/games/nethack and requires root privileges for that destination.",
    ],
    ["make", "cc", "ld", "vi"],
  ),
  page(
    "cc",
    1,
    "compile and link bounded CS C programs",
    [
      "cc [-mword32|-mbyte8] [-c] [-I DIR] [-D NAME[=VALUE]] [-U NAME] SOURCE... [-L DIR] [-l NAME] [-o OUTPUT]",
      "c++ accepts the same data-model options for its supported C-compatible subset",
    ],
    [
      "The default cs-word32-v1 profile has CHAR_BIT=32 and one 32-bit word per char, short, int, long, and pointer. -mbyte8 (or -mdata-model=cs-byte8-v1) selects 8-bit char, 16-bit short, and 32-bit int, long, and pointer layout. -mword32 explicitly selects the default.",
      "Current objects are CS486OBJ v4, executables are CS486 v5, and archives are CS486AR v2. Each carries one data-model identity. cc selects /usr/lib/<data-model>/libc.csa; ld, archive selection, Python extension loading, and all output installation reject a mixed model.",
      "Byte-profile file counts are bytes and preserve all values 0 through 255 without UTF-8 or newline conversion. Word-profile file counts remain word characters. <cs/byte.h> explicitly packs four octets per unsigned-int storage unit for word applications, but does not make word unsigned-char pointers byte compatible.",
      "float is binary32, double is binary64, and long double aliases double. Deterministic software arithmetic and constant folding share round-to-nearest ties-to-even semantics. Use -lm for the bounded <math.h> profile; variadic float promotes to double and %f accepts at most 18 fractional places.",
      "Both profiles are bounded Computer System ABIs, not native x86, ELF, OMF, or ISO/POSIX conformance claims.",
    ],
    ["ar", "ld", "make", "math", "csdb"],
  ),
  page(
    "math",
    7,
    "deterministic bounded CS C floating-point and libm profile",
    ["#include <float.h>", "#include <math.h>", "cc program.c -lm -o program"],
    [
      "float is IEEE-754 binary32 and double is binary64. long double is an alias of double. Both are little endian, four-byte aligned, and use round-to-nearest ties-to-even.",
      "The initial guest libm supplies fabs, copysign, floor, ceil, trunc, round, fmod, sqrt, ldexp, frexp, modf, isnan, isinf, isfinite, signbit, and appropriate f variants. Invalid results set EDOM; divide-by-zero, overflow, and underflow set ERANGE through process-local status.",
      "Decimal and hexadecimal literals, constant folding, runtime operations, and %f formatting use the same bounded integer/rational software core. Results never delegate to host libm, locale, JavaScript floating arithmetic, WebAssembly, or a native addon.",
      "Trigonometric, exponential, logarithmic, pow, complex, mutable fenv, x87/SIMD, fast-math, and arbitrary precision are not implemented.",
    ],
    ["cc", "ld", "ar"],
  ),
  page(
    "make",
    1,
    "build bounded CS-Linux targets from a Makefile",
    ["make [-f FILE] [-C DIR] [-n] [-B] [-s] [NAME=value ...] [TARGET ...]"],
    [
      "CS Make 1.0 parses explicit and indexed pattern rules, .PHONY, =, :=, ?=, +=, required or optional Makefile includes, ifeq/ifneq/ifdef/ifndef with else/endif, make variables, and the automatic variables $@, $<, $^, and $*.",
      "The first non-special rule is the default target. Guest mtimes and bounded CSMAKE2 SHA-256 input/output records skip a target only while recipe and toolchain identity also match. Missing, evicted, legacy, or foreign records rebuild; malformed state fails. -B forces rebuilding and -n prints recipes without executing them.",
      "Makefile parsing, planning, and fingerprints begin after the make PID and 128 KiB lease are admitted. The initial bounded scheduler step plans without running a recipe; each admitted recipe then executes as one isolated guest command per scheduler tick. Successful targets commit generated .d prerequisites after recipe I/O and post-build verification. Allowed commands include as, cc, c++, ar, ranlib, ld, inspection tools, and bounded filesystem/output utilities. Pipelines, redirects, command chains, background work, host commands, recursive make, arbitrary implicit-rule search, and parallel jobs are unavailable.",
      "Makefiles are limited to an aggregate 32768 characters, 256 lines, 64 includes at depth 8, 128 rules/patterns, 512 dependency edges, 256 recipe lines, graph depth 32, and 16 MiB of fingerprint content. CS-DOS does not install make; use CS PROGRAM LIST/PWB there.",
    ],
    ["cc", "ar", "ld", "sh"],
  ),
  page(
    "ar",
    1,
    "create and inspect bounded CS486AR static archives",
    ["ar {rcs|r|d|t|x} ARCHIVE [MEMBER ...]"],
    [
      "Current CS486AR version 2 contains validated CS486OBJ members, canonical member order, SHA-256 member digests, a bounded global-symbol index, explicit ABI/data-model identity, and an archive checksum. Version 1 remains readable as the legacy word model. It is not Unix ar, ELF, OMF, or a native library.",
      "r or rcs creates/replaces members, d deletes, t lists, and x extracts into the current guest directory. Every mutation validates a complete trial and atomically replaces the archive; failure leaves the prior file unchanged.",
      "An archive contains at most 128 members and 8192 indexed symbols and has an 8 MiB encoded limit. Names are bounded basenames. All input/output stays in the credentialed guest filesystem.",
    ],
    ["ranlib", "cc", "ld"],
  ),
  page(
    "ranlib",
    1,
    "refresh a CS486AR symbol index",
    ["ranlib ARCHIVE"],
    [
      "ranlib validates every CS486OBJ member and deterministically rebuilds the canonical CS486AR global-symbol index before one atomic replacement.",
      "Duplicate exports, corrupt members, incompatible formats, capacity overflow, DAC denial, and output failure terminate explicitly without publishing a partial index.",
    ],
    ["ar", "ld"],
  ),
  page(
    "git",
    1,
    "manage bounded local CS System Git repositories",
    [
      "git init [-b BRANCH] [DIRECTORY]",
      "git status [--short] | git add [-A] [-f] PATH... | git rm [-r] [-f] [--cached] PATH...",
      "git commit -m MESSAGE | git log [--oneline] [-n COUNT] | git show [REV] | git diff [--cached] [PATH...]",
      "git branch [NAME [START]] | git switch [-c NAME [START]|--detach REV|BRANCH] | git checkout [-b NAME [START]|BRANCH|REV]",
      "git merge [--ff-only] [-m MESSAGE] REV | git tag [NAME [REV]]",
      "git remote [-v]|add|remove|get-url|set-url | git config [--get|--unset] user.name|user.email [VALUE]",
    ],
    [
      "CS System Git 1.0 is a Git-like, independently implemented local version-control system. It uses a .git directory and familiar commands, but its required computerSystemVcs repository extension, object encoding, and index are intentionally not interoperable with native Git.",
      "Content-addressed SHA-256 blob, tree, and commit objects preserve binary file contents, executable-file mode, and symbolic-link targets. They do not version uid/gid, timestamps, hard-link identity, empty directories, or device metadata. Index, checkout, merge, commit, and compare-and-swap ref updates use bounded guest-filesystem transactions; repository ownership and every .git symlink are checked before use. Merge is exact-path three-way plus fast-forward: rename detection, octopus merge, recursive synthesis of multiple merge bases, and conflict-marker worktrees are unavailable and fail before mutation.",
      ".gitignore files, .git/info/exclude, negation, anchored patterns, **, ?, character classes, directory rules, and git add -f are supported. The walker never follows symbolic links or descends into an excluded parent to rediscover a negated child. Hooks, helpers, filters, submodules, LFS, signing, shallow history, alternate object stores, environment path overrides, and native Git config includes are unavailable.",
      "One repository tracks at most 256 paths, scans 512 worktree entries, stores 2048 objects, reads 256 commits per history operation, and limits one object to 384 KiB. Ignore files, patterns, config, output, total bytes, and work units have separate ceilings. Each command acquires and always releases a 1 MiB guest RAM lease; bounded payload, hash, object, and transaction buffers are processed sequentially, and all object and worktree bytes pass through guest block-I/O accounting.",
      "remote stores cs+tcp://, ssh://, or https:// metadata without inline credentials. clone, fetch, pull, and push fail explicitly in CS-Linux 1.0 because authenticated guest TCP/IP transport is not installed. The future guest-only port requires peer verification before scoped credential use, capability negotiation, per-tick and total ceilings, chunked objects, bounded backoff, quarantine verification/promotion, ref CAS, and exactly-once cleanup. A lost update acknowledgement terminates as unknown and must be reconciled before retry.",
    ],
    ["diff", "sha256sum", "vi"],
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
    "base64",
    1,
    "encode or decode data in base64",
    ["base64 [FILE]", "base64 -d [FILE]"],
    [
      "Encode a file or stdin to base64, wrapped at 76 columns, or decode with -d/--decode. Decoding rejects malformed base64 text or a decoded byte sequence that is not valid UTF-8, matching this shell's text-only file model.",
    ],
    ["md5sum", "sha256sum"],
  ),
  page(
    "md5sum",
    1,
    "print the MD5 digest of a file or stdin",
    ["md5sum [FILE ...]"],
    [
      "Compute a bounded, pure-guest MD5 digest, printed as 32 hex characters followed by the source name. Reads stdin when no file is given.",
    ],
    ["sha256sum", "base64"],
  ),
  page(
    "nl",
    1,
    "number the non-blank lines of a file",
    ["nl [FILE ...]"],
    [
      "Print each input line preceded by a right-justified line number and a tab; blank lines are printed unnumbered. Reads stdin when no file is given.",
    ],
    ["cat", "wc"],
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
    ["man [SECTION] TOPIC"],
    [
      "Pages come from the same versioned command metadata shipped with the OS image. This command does not access the Internet or host manual database.",
    ],
    ["apropos", "cs-linux"],
  ),
  page(
    "less",
    1,
    "page through a file or live pipeline with backward and forward scrolling",
    ["less [PATH|-]", "COMMAND | less"],
    [
      "A bounded full-screen pager over one file, redirected stdin, -, or live pipe input. It must be the final terminal-owned pipeline stage. Navigation keys stay on the controlling terminal and never become document bytes; live input reports an unfinished length and retains at most 64 KiB.",
      "Space/PageDown or f advance one screen; PageUp or b go back one screen; Enter/j/ArrowDown and k/ArrowUp move one line; g and G jump to the top and bottom; q quits back to the shell prompt.",
      "Quitting closes the pipe reader so an active producer observes SIGPIPE status 141. Parent-mutating commands and other terminal-exclusive programs cannot share the pipeline.",
    ],
    ["more", "vi", "cat"],
  ),
  page(
    "more",
    1,
    "page forward through a file or live pipeline one screen at a time",
    ["more [PATH|-]", "COMMAND | more"],
    [
      "A bounded forward-only pager over one file, redirected stdin, -, or live pipe input, matching traditional more instead of less's full scrolling. It must be the final terminal-owned pipeline stage; live input retains at most 64 KiB and terminal keys never enter the document stream.",
      "Space/PageDown advances one screen and Enter advances one line; q quits back to the shell prompt.",
      "Quitting closes the pipe reader so an active producer observes SIGPIPE status 141. Parent-mutating commands and other terminal-exclusive programs cannot share the pipeline.",
    ],
    ["less", "vi", "cat"],
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
    "pgrep",
    1,
    "list process IDs matching a name",
    ["pgrep [-l] [-x] PATTERN"],
    [
      "Match PATTERN against each process's command name (the final path segment before its arguments) from the bounded OS process table. Default matching is a substring; -x requires an exact name match. -l also prints the matched name.",
      "Prints nothing and exits nonzero when no process matches.",
    ],
    ["ps", "pkill", "killall"],
  ),
  page(
    "pkill",
    1,
    "signal processes matching a name",
    ["pkill [-SIGNAL] [-x] PATTERN"],
    [
      "Send SIGNAL (default TERM) to every process whose command name matches PATTERN, using the same substring/-x matching as pgrep. Ownership and PID 1 protection follow kill's rules.",
    ],
    ["pgrep", "kill", "killall"],
  ),
  page(
    "killall",
    1,
    "signal processes by exact command name",
    ["killall [-SIGNAL] NAME ..."],
    [
      "Send SIGNAL (default TERM) to every process whose command name exactly matches each given NAME. A NAME with no match reports an explicit error but does not stop remaining names from being processed.",
    ],
    ["pkill", "kill", "pgrep"],
  ),
  page(
    "service",
    8,
    "inspect real CS-Linux service state",
    ["service --status-all", "service NAME status"],
    [
      "Service mutation is owned by cs-init and is not exposed by this status-only command. CS-Linux does not imitate systemd.",
    ],
    ["dmesg", "ps", "telinit", "crontab"],
  ),
  page(
    "telinit",
    8,
    "change the SysV runlevel",
    ["telinit {0-6|S}"],
    [
      "Requires superuser privilege. Runlevels 0 and 6 reuse the existing shutdown/reboot lifecycle; 1 and S stop rc.d multi-user services; 2-5 are identical multi-user runlevels.",
      "Starts and stops the rc.d-managed services listed in the target /etc/rcN.d directory in place; it does not itself power off or restart the Computer for runlevels 1-5.",
    ],
    ["init", "runlevel", "service", "shutdown", "reboot"],
  ),
  page(
    "init",
    8,
    "alias for telinit",
    ["init {0-6|S}"],
    [
      "init is the conventional alias for telinit; see telinit(8) for behavior.",
    ],
    ["telinit", "runlevel"],
  ),
  page(
    "runlevel",
    8,
    "print the previous and current SysV runlevel",
    ["runlevel"],
    [
      'Prints "PREVIOUS CURRENT", using N for previous when no runlevel change has occurred yet, or "unknown" before the first runlevel is established.',
    ],
    ["telinit", "init"],
  ),
  page(
    "crontab",
    1,
    "list or edit the single CS-Linux system crontab",
    [
      "crontab -l",
      "crontab -e",
      "/etc/crontab: minute hour day-of-month month day-of-week user command",
    ],
    [
      "Seven whitespace-separated fields: minute hour day-of-month month day-of-week user command.",
      "Each numeric field accepts *, a bare number, a-b ranges, comma lists, and */n or a-b/n steps. day-of-week accepts 0-7 (0 and 7 are both Sunday).",
      "cron re-reads /etc/crontab only when the cron service starts or restarts; edits do not take effect until then. -e opens that file in vi and requires a durable root login shell; no per-user spool exists.",
    ],
    ["service"],
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
  page(
    "sed",
    1,
    "bounded stream editor",
    ["sed [-n] [-e SCRIPT] SCRIPT [FILE ...]"],
    [
      "Supports p, d, and s/pattern/replacement/g with numeric, $, or /pattern/ addresses. Patterns use the bounded CS matcher, including top-level | alternatives, not host regular expressions.",
    ],
    ["awk", "grep"],
  ),
  page(
    "awk",
    1,
    "bounded record and field processor",
    ["awk [-F CHAR] PROGRAM [FILE ...]"],
    [
      "Supports BEGIN/END, /pattern/, field comparisons, print, bounded printf, $0..$64, NR, and NF. Rule actions also support bounded scalar =, +=, -=, ++, and -- updates plus +, -, *, /, and parenthesized arithmetic; arrays, functions, and host evaluation are unavailable. Programs, records, fields, rules, variables, and matcher steps have fixed limits.",
    ],
    ["sed", "cut"],
  ),
  page(
    "grep",
    1,
    "search bounded text lines",
    ["grep [-Finv] PATTERN [FILE ...]"],
    [
      "Searches stdin when no file is given, or only the explicit guest files supplied. -i ignores case, -n prefixes a line number, -v inverts selection, and -F treats PATTERN literally. Otherwise PATTERN uses the bounded CS matcher, including top-level | alternatives; recursive host or guest scanning is not implied.",
    ],
    ["rg", "awk", "sed"],
  ),
  page(
    "rg",
    1,
    "search explicitly named guest files with bounded ripgrep-style flags",
    ["rg [-Filnv] PATTERN [FILE ...]"],
    [
      "The supported subset is grep-compatible -F, -i, -n, and -v plus -l, which prints each matching explicit file once. With no file operand it reads stdin. It does not walk directories, honor glob configuration, start a host process, or claim full ripgrep compatibility.",
    ],
    ["grep", "find"],
  ),
  page(
    "jq",
    1,
    "query bounded guest JSON without host evaluation",
    ["jq [-r] FILTER [FILE ...]"],
    [
      "Reads JSON values from stdin or explicit guest files. The bounded filter subset supports ., field and bracket-key lookup, array indexes and [], length, keys, |, [FILTER], and select(.field == JSON) or !=. -r prints strings without JSON quotes. Recursive descent, arbitrary functions, assignment, modules, and host JavaScript evaluation are unavailable.",
    ],
    ["grep", "awk", "cat"],
  ),
  page(
    "cut",
    1,
    "select bounded character positions or delimited fields",
    ["cut -c LIST [FILE ...]", "cut [-d DELIMITER] -f LIST [FILE ...]"],
    [
      "LIST accepts comma-separated one-based positions and inclusive ranges such as 1,3-5, capped at 1,000 selected positions. -c selects characters; -f selects fields and joins them with the one-character delimiter, which defaults to a tab.",
    ],
    ["tr", "awk"],
  ),
  page(
    "tr",
    1,
    "translate or delete a bounded character set",
    ["tr SET1 SET2", "tr -d SET"],
    [
      "Maps each character from SET1 to its matching SET2 character, reusing SET2's last character when needed. -d removes SET characters. Backslash escapes and short ascending ranges are supported; locale classes, squeeze mode, and host text utilities are unavailable.",
    ],
    ["cut", "sed"],
  ),
  page(
    "python",
    1,
    "compile and run bounded Computer System Python",
    ["python", "python [--stats] FILE", "micropython [--stats] FILE"],
    [
      "With no operands, starts a persistent interactive session on one validated CS486 process. The >>> and ... prompts collect bounded cells; globals, imports, functions, classes, closures, and generators remain available to later cells without replacing the process, PID, scheduler entry, or RAM grant.",
      "A compound statement stays at ... until a blank line commits the suite. Open delimiters and triple-quoted strings commit when they close. A non-None final expression is displayed once with the bounded Python representation; an already loaded source module is reused rather than initialized again.",
      "Ctrl+D exits at an input prompt. Ctrl+C at >>> or ... discards only the pending cell; Ctrl+C while a cell is executing terminates that REPL with status 130 because a terminated CS486 process is never replaced silently. Interactive cell source is excluded from shell history and is capped at 512000 UTF-8 bytes per session.",
      "The interactive form is terminal-only and rejects redirects, pipelines, background execution, command scripts, MCP debug use, --stats, and filesystem CS486OBJ extension imports. FILE mode retains its existing foreground, redirect, pipeline, background, extension, MCP, and statistics behavior.",
      "Computer System Python 1.0 is a bounded partial implementation targeting Python 3.14 syntax and core semantics, not a CPython or full Python 3.14 compatibility claim. User Python is unavailable on CS386SX and returns status 127.",
    ],
    ["perl", "vi", "run"],
  ),
  page(
    "perl",
    1,
    "bounded Perl 5 interpreter",
    [
      "perl [-c] [-w] [-l] [-n | -p] [-a] [-F PATTERN] [-e PROGRAM] [- | SCRIPT] [ARG ...]",
      "perl -v",
    ],
    [
      "Runs a bounded subset of Perl 5.40 inside the guest: scalars, arrays, hashes, my scoping, subroutines, references-free data, statement modifiers, sort/grep/map blocks, sprintf, split, join, here-documents, loop labels, tr///cdrs, and s/// with the e and r modifiers, all matched by the bounded CS matcher instead of host regular expressions.",
      "With no -e program or script, perl reads program text from standard input. A pipe or < redirect supplies that source immediately; on the terminal, enter source lines and press Ctrl+D to run them or Ctrl+C to discard them. Source lines are not shell history. Consumed program source is not replayed as runtime STDIN, so use -e or a script when processing piped data.",
      "Program text, statements, variables, output, open handles, recursion depth, and matcher steps all have fixed limits, and exceeding one fails explicitly with exit status 2.",
      "Perl control flow compiles to ordinary CS486 instructions and runs as one scheduler-owned process. Bounded value, regex, and guest-I/O semantics use its allowlisted managed syscall ABI; shell and MCP CPU reports are the instructions and cycles actually executed by Cs486Process, not an interpreter-step conversion.",
      "Modules, references, bless, eval STRING, fork, exec, system, backticks, and any host escape are rejected at compile time. Hash iteration order is insertion order, so scripts stay deterministic.",
    ],
    ["awk", "python", "sed"],
  ),
  page(
    "tar",
    1,
    "create, list, or extract bounded ustar archives",
    ["tar -cf ARCHIVE PATH ...", "tar -tf ARCHIVE", "tar -xf ARCHIVE [-C DIR]"],
    [
      "Uses binary-safe guest files and POSIX ustar headers. Extraction preflights checksums, paths, duplicates, symlink pivots, entry count, and expanded bytes, then commits atomically.",
    ],
    ["gzip", "zip"],
  ),
  page(
    "gzip",
    1,
    "compress or decompress bounded gzip files",
    ["gzip [-d] [-k] FILE ..."],
    [
      "Writes deterministic RFC 1952 streams with stored DEFLATE blocks and validates CRC32 and size on decode. Unsupported DEFLATE block forms fail explicitly.",
    ],
    ["gunzip", "tar"],
  ),
  page(
    "gunzip",
    1,
    "decompress bounded gzip files",
    ["gunzip [-k] FILE.gz ..."],
    ["Equivalent to gzip -d for the supported bounded gzip stream."],
    ["gzip"],
  ),
  page(
    "zip",
    1,
    "create bounded stored ZIP archives",
    ["zip ARCHIVE.zip PATH ..."],
    [
      "Creates standard UTF-8 ZIP archives using method 0 with local headers, a central directory, and CRC32.",
    ],
    ["unzip", "tar"],
  ),
  page(
    "unzip",
    1,
    "list or extract bounded stored ZIP archives",
    ["unzip [-l] ARCHIVE.zip [-d DIR]"],
    [
      "Accepts unencrypted method-0 ZIP entries. ZIP64, encryption, and compressed methods fail explicitly; extraction uses the same atomic path safety as tar.",
    ],
    ["zip", "tar"],
  ),
  page(
    "nice",
    1,
    "run guest work with a bounded scheduling weight",
    ["nice [-n -20..19] COMMAND ..."],
    [
      "Captures the nice value at process admission. Negative values require root; four deterministic weight bands preserve bounded scheduler work and prevent starvation.",
    ],
    ["ps", "nohup"],
  ),
  page(
    "nohup",
    1,
    "detach a supported bounded background task from terminal hangup",
    ["nohup {sleep|python|micropython|run} ... &"],
    [
      "Reparents the admitted task to init and ignores terminal SIGHUP. Shutdown and reboot remain finalization owners; unsupported foreground forms fail explicitly.",
    ],
    ["nice", "jobs"],
  ),
  page(
    "watch",
    1,
    "repeat a finite command on guest ticks",
    ["watch [-n SECONDS] [-c COUNT] -- COMMAND ..."],
    [
      "Runs one finite non-interactive command per interval. COUNT defaults to 300 and is capped at 3600; Ctrl+C, failure, disconnect, and completion each reach an explicit foreground terminal state.",
    ],
    ["top", "nice"],
  ),
  page(
    "vmstat",
    1,
    "print one bounded virtual-memory statistics snapshot",
    ["vmstat"],
    [
      "Render one non-interactive report line from the authoritative memory snapshot and process table: runnable and waiting process counts plus free memory and reclaimable buffers in KiB.",
      "CS-Linux models no swap device and no sampled interrupt or context-switch counters, so the swap, io, and system columns are always zero. Interval and count operands are not supported.",
    ],
    ["ps", "top"],
  ),
] satisfies readonly LinuxManualPage[]);

const pagesByName = new Map(pages.map((entry) => [entry.name, entry] as const));
pagesByName.set("micropython", pagesByName.get("python")!);

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
