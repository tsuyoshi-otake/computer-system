# Issue #119: bounded CS-Linux Perl 5 interpreter

Status: implemented and verified on the host, real BDS, and real Chrome.

CS-Linux already shipped `awk`, `sed`, and a Python 3.14 profile but had no
`perl`. This issue adds one, so the classic Unix scripting layer is complete.

The interpreter targets a modern Perl 5.40 surface (`use strict`,
`use warnings`, `use v5.40`, `say`) rather than a retro perl4 dialect, matching
the way the repository already targets Python 3.14 on retro hardware. It is a
bounded Computer System profile, not a port of upstream perl and not a POSIX or
CPAN conformance claim.

## Implemented boundary

Three new modules under `src/application/os/`:

- `linuxPerlRegex.ts` — a guest-owned backtracking matcher with alternation,
  groups and captures, greedy and non-greedy `* + ? {n,m}`, character classes,
  escapes, anchors, `\b`, and the `g`/`i`/`m`/`s` flags. Compilation and
  matching run under fixed node, capture, pattern-length, repetition, and step
  budgets. No guest-controlled pattern reaches a host `RegExp`.
- `linuxPerlParser.ts` — a bounded lexer and precedence parser producing a
  frozen AST. Statements carry their source line so `die`/`warn` can report it.
  Unsupported syntax fails at parse time with an explicit message.
- `linuxPerl.ts` — a tree-walking interpreter with a step budget, scalar/list/
  aggregate context, `my` scoping, subroutines and recursion, `@_`, capture
  variables, `$_`, `$.`, `$0`, `$@`, `$!`, `%ENV`, `@ARGV`, statement modifiers,
  `foreach` aliasing, `sort`/`grep`/`map` blocks, `sprintf`/`printf`, `split`,
  `join`, `tr///cdrs`, `m//`, `s///` with the `e` and `r` modifiers,
  here-documents (`<<TAG`, `<<"TAG"`, `<<'TAG'`, and indented `<<~TAG`), loop
  labels with `next LABEL`/`last LABEL`, `eval BLOCK`, `die`/`warn`/`exit`, and
  bounded three-argument `open` against the guest filesystem only.

Command-line switches: `-e`, `-n`, `-p`, `-l`, `-a`, `-F`, `-c`, `-w`/`-W`,
`-v`/`--version`, `--`, and a script path with its own `@ARGV`. Bare `perl` and
an explicit `perl -` read program source from standard input. A pipe or
redirection executes that source at EOF. A controlling-terminal invocation
collects source until Ctrl+D and lets Ctrl+C cancel without compiling or
executing it. Source bytes are never replayed as the executed program's data
stdin.

### CS486 execution extension (2026-07-31)

`src/application/runtime/perlCs486.ts` compiles Perl branches, loops, and
expression operations to the production CS486 instruction set. The resulting
single `Cs486Process` owns the instruction pointer, cycle debt, scheduler
slices, PID, and RAM grant. Bounded Perl value, regex, and guest-I/O semantics
cross one allowlisted managed syscall boundary. There is no host Perl process
and no second CPU implementation.

### Determinism

- Hash iteration is insertion-ordered, not randomized as in upstream perl, so a
  program's output is a deterministic function of its input.
- `time()` fails explicitly ("CS-Linux perl has no wall clock") instead of
  leaking host time into a guest run.
- File I/O routes through the same credentialed guest filesystem as every other
  command. Host paths never appear in guest-visible errors.
- The semantic step counter remains only as a hard safety limit. It is not CPU
  accounting. Normal terminal and MCP execution report the instructions and
  cycles produced by the sole `Cs486Process`, including deterministic syscall
  service cycles.
- Python and Perl use one shared bounded instruction-equivalent tariff for
  managed dispatch, type checks, loads, stores, iterator acquisition/steps,
  collections, and string traversal. Add/compare, multiply, divide/modulo, and
  power retain distinct 486-class ordering. Python arbitrary-precision integer
  work scales by 30-bit limb count; Perl follows its documented scalar-double
  representation. A fixed per-language or benchmark-specific multiplier is not
  used, and the model does not claim cycle-exact upstream CPython/perl
  internals.

### Limits

`linuxPerlLimits`: 1,000,000 execution steps, 1 MiB stdin, 1 MiB stdout (and the
same ceiling per file handle and for diagnostics), 65,536 array elements, 65,536
hash entries, 262,144 scalar characters, 8 open handles, call depth 64, and a
128-entry compiled-pattern cache. `perlParserLimits`: 64 KiB of program text,
4,096 statements, 32,768 tokens, block depth 32, and 8,192 string characters.
`perlRegexLimits`: 200,000 matcher steps, 512 nodes, 512 pattern characters, 16
capture groups, and 1,024 repetitions.

Output is admitted before it is appended, so a rejected write leaves the stream
exactly at its bound rather than one record past it. A bound violation exits 2;
`die` and compile errors exit 255; `exit N` is honoured.

### Explicit rejections

Rejected at compile time rather than approximated: modules outside the pragma
allowlist (`strict`, `warnings`, `feature`, `utf8`, `integer`, `constant`,
`lib`, `vars`, and `use v5.x`), references and nested data structures, `bless`
and `->`, `eval STRING`, POD, backticks, subroutine prototypes, package
variables, `local`, `our`, `goto`, `format`, `tie`, `wantarray`, `fork`, `exec`,
`system`, `qx`, `chdir`, and `qr`. Lookaround, named, and modifier groups fail
in the matcher, so `%+` named captures are unavailable. A label is accepted only
on `while`, `until`, `for`, and `foreach`; anywhere else it fails explicitly.

### Known divergences from upstream perl

- No IV/NV duality. Every number is a double, so an integer above 2^53 loses the
  exact decimal form upstream perl keeps: `print 9007199254740993` yields
  `9.00719925474099e+15` rather than the original digits.
- Hash iteration is insertion-ordered by design (see Determinism above), so a
  program that depends on upstream's randomized order behaves differently here.
- `do BLOCK while` and `%+` named captures are unimplemented, not approximated.

## Wiring

- `perl` in `linuxCommands` (`commandRegistry.ts`) and the shell dispatch and
  `help` index (`shellCommands.ts`).
- `man perl` (`linuxManual.ts`).
- The terminal interaction descriptor, Bedrock bridge, Web companion, and
  browser input path carry one explicit EOF event. EOF is accepted only for a
  current writer, generation, context, and an interaction that advertises it.
  The shell owns one bounded Perl source collector (64 KiB and 4,096 lines),
  excludes its lines from history, and releases its RAM lease on completion,
  cancellation, disconnect, logout, or shutdown.
- `/usr/bin/perl` at 81,920 bytes in the new `cs-linux-1.0-rootfs-v20` base
  image. `cs-linux-1.0-rootfs-v19` is retained as the historical image without
  it, and `osProfile.ts` accepts v20 as a non-migrating previous image, so an
  existing Computer keeps its overlay and a deleted `/usr/bin/perl` keeps its
  tombstone.
- README, the Web Terminal manual chapters 4.2 and 4.14.

## Acceptance evidence

1. Verify: `perl -e 'print "hi\n"'` Expect: `hi`, exit 0. — covered by
   `tests/os/linuxPerl.test.ts` "prints from -e and reports its version".
2. Verify: `printf 'a 1\nb 2\n' | perl -lane 'print "$F[0]:$F[1]"'` Expect:
   `a:1` and `b:2`, exit 0. — covered by "splits records with -l, -a, -n, and
   -F" and the shell-integration pipeline case.
3. Verify: a script using `my`, arrays, hashes, `foreach`, `sub`, `sort`,
   `grep`, `map`, `s///g`, and captures Expect: the expected text. — covered by
   "combines my, arrays, hashes, foreach, sub, sort, grep, map, s///g, and
   captures".
4. Verify: `perl -e 'use nonesuch;'` Expect: explicit unsupported-module error
   on stderr, non-zero exit, no partial stdout. — covered by "rejects an
   unsupported module without partial output".
5. Verify: `perl -e 'while (1) {}'` Expect: bounded step-limit failure instead
   of a hung tick. — covered by "stops a runaway loop at the step limit instead
   of hanging".
6. Verify: delete `/usr/bin/perl`, then `perl -e 1` Expect: 127. — covered by
   "returns 127 once the installed executable is deleted", which also proves the
   unprivileged session cannot delete the executable itself.
7. Verify: `printf 'print "pipe\\n";' | perl` and `perl < /tmp/program.pl`
   Expect: each source executes once at EOF and receives an empty runtime stdin.
   — covered by the shell-session pipe and redirect cases and the interpreter's
   prepared-stdin-source cases.
8. Verify: start bare `perl`, enter multiple source lines, then send Ctrl+D
   Expect: one compile/run and the shell prompt is restored. Send Ctrl+C instead
   Expect: status 130, no execution, no retained source/history/RAM. — covered
   by the terminal interaction, source-capacity, cancellation, disconnect, and
   history cases.
9. Verify: `npm run validate` Expect: exit 0. — observed 2026-07-30 on Node 24,
   Windows 11: Prettier, ESLint, `tsc --noEmit`, 2,670 Vitest cases in 313
   files, the Bedrock pack build, and the 16-chapter Pages build all passed.
10. Verify: start bare `perl` in a real-BDS Web Terminal, enter
    `print "final-tty\\n";`, then send Ctrl+D. Expect: `final-tty` once and one
    restored shell prompt. — observed 2026-07-30 on Computer `c-r20rqv` with the
    TypeScript CS486 engine and two bounded runtime workers. Chrome rendered the
    exact output and prompt with no console diagnostics or horizontal overflow.
    `man perl` and the Web Manual Perl section were also visibly inspected in
    the preceding isolated real-BDS run.
11. Verify: execute the same bounded Perl workload twice through MCP, then a
    shorter Perl workload. Expect: the repeated runs return the same CPU cycles,
    the longer workload returns more than the shorter workload, and neither is
    the shell-only 8-cycle placeholder. Covered by `tests/os/linuxPerl.test.ts`
    and `tests/computer/computerHost.test.ts`. Observed 2026-07-31 on an
    isolated real BDS, CS486DX2 at 66 MHz, after applying the shared managed
    tariff: the aligned 1,500-iteration checksum returned 893,439 Python cycles
    and 1,052,332 Perl cycles in all three repetitions, exit 0, with no BDS
    diagnostics. The aligned 100-iteration workloads returned 23,119 Python
    cycles and 36,161 Perl cycles. This proves that both languages scale under
    their production `Cs486Process` accounting without a ranking-specific
    multiplier. The isolated BDS stopped afterward while the normal development
    server remained running. Earlier accounting captures remain only as
    superseded provenance in the benchmark JSON.

Current focused verification passed 105 tests across the shared cost model,
Python CS486/numeric, Perl, and ComputerHost suites. `npm run validate` then
passed formatting, ESLint, TypeScript, all 2,693 Vitest tests in 314 files, the
Bedrock pack build, and the 16-chapter Pages build. No Vitest process survived
either run.

Focused verification: the 12-file Perl/Python/runtime/Computer/terminal/Web/BDS
command passed 238 tests, including the Perl interpreter and shell-session
suites, with no surviving Vitest process.

## Measured fidelity against upstream perl

Fidelity was measured, not asserted. A differential harness bundled
`linuxPerl.ts` with esbuild and ran each program through both the guest
interpreter and host perl 5.38.2 (Git Bash), comparing exact stdout and exit
status. Observed 2026-07-29 across four waves totalling 373 programs:

| Wave | Focus                                                  | Scored  |
| ---- | ------------------------------------------------------ | ------- |
| 1    | core language, switches, I/O, rejections               | 140/140 |
| 2    | context, numeric edge cases, regex, sort, sprintf      | 92/93   |
| 3    | idiomatic modern Perl a script would actually use      | 86/86   |
| 4    | the features added while closing wave 3, and their mix | 48/48   |

Total 366/367 = 99.7 %. The single remaining mismatch is `num-large`, the IV/NV
limitation recorded above. Cases exercising a declared rejection are excluded
from the score and asserted separately.

Defects the harness found and this issue fixed, each now covered by a case in
"CS-Linux perl differential fidelity":

- `split` with a negative limit kept trailing empty fields; only an omitted or
  zero limit strips them.
- `chomp`/`chop` returned the string instead of the count and removed character.
- Four-argument `substr` and `substr` as an assignment target were unavailable.
- `^` under `/m` matched after a trailing newline, so `"a\nb\n"` reported three
  line starts instead of two.
- `tr///` ignored the `c`, `d`, `r`, and `s` modifiers; `tr///r` and `s///r`
  additionally demanded an assignment target they never write to.
- Bitwise operators truncated to 32 bits instead of perl's 64-bit unsigned
  result, so `~0 & 255` produced 0.
- Hash and array slices could not be assigned to; `$#a = N` could not resize.
- `$&`, `` $` ``, and `$'` were absent.
- A bare `while (<FH>)` did not read into `$_`.
- `undef` was an empty string, so `defined(undef)` was true and
  `exists`/`defined` could not disagree.
- `hex` ignored a `0x` prefix; `x=`, `shift // default`, `quotemeta`, loop
  labels, `s///e`, and here-documents were unavailable.
