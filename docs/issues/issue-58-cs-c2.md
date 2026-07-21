# Issue #58: CS C 2.0 - complete C language frontend

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/58

Status: complete and host/real-BDS/Web-Terminal-verified. The control-flow and
expression increment originally recorded here was completed by the typed data,
ABI, hosted-runtime, byte-data-model, and deterministic-floating-point work in
Issues #61, #63, and #69-#73. Issue #99 now supplies the isolated authenticated
fixture used for the required real Web Terminal guest build/run.

## Implemented boundary

- Full control flow in `cs486CFrontend.ts`: `if`/`else if`/`else`, `while`,
  `do`/`while`, `switch`/`case`/`default` with genuine C fallthrough (compiled
  to a compare chain, no jump table - the CS486 ISA has no indirect jump),
  `break`/`continue` validated against the innermost loop/switch at parse time.
- Full expression grammar: assignment remains statement-level, but the
  right-hand side now supports the complete precedence ladder - ternary `?:`,
  `||`, `&&` (both with genuine short-circuit branch lowering, not eager
  both-sides evaluation), bitwise `| ^ &`, equality `== !=`, relational
  `< <= > >=`, shift `<< >>`, additive/multiplicative (unchanged), and unary
  `! ~ + -`.
- CSIR's strict `i1`/`i32` value typing is respected throughout: every
  comparison/logical result is genuinely `i1`-typed and coerced back to `i32`
  only where a C value is required (assignment, return, printf, ternary/`&&`/
  `||` results), using branch-based materialization since the frontend does not
  use SSA phi nodes.
- `std::cout << value << std::endl` continues to parse correctly alongside
  general shift operators: the cout value position is intentionally bounded
  below shift precedence so a bare trailing `<<` always resumes stream-chaining
  rather than being consumed as a bitwise shift (parenthesize an explicit shift
  value to opt back in).
- `for`'s existing induction-variable loop gained a dedicated increment block so
  `continue` correctly still runs the increment step before re-testing the
  condition, matching C semantics.
- Parser nesting/token budgets raised modestly (`maximumExpressionDepth`
  48->160, `maximumExpressionTokens` 128->256) to accommodate the deeper
  precedence ladder without materially loosening bounds; new
  `maximumSwitchCases` (64) and `maximumSyntheticLocalsPerFunction` (512,
  covering the frontend's own short-circuit/ternary/coercion temporaries) caps
  added.
- `web/manual.js` Chapter 12 describes the complete current bounded profile,
  including parameters, pointers, arrays, aggregates, globals, hosted ABI,
  byte-data-model, archive, and deterministic floating-point extensions.

## Current explicit exclusions

The current profile still excludes native x86/ELF/OMF ingestion, dynamic
linking, unrestricted POSIX processes/threads/sockets, host compilers and libc,
mutable floating-point rounding modes, extended precision, unrestricted locale
or terminal databases, and unbounded input/output. Issue #64's preserved NetHack
prototype remains frozen and is not completion evidence for this Issue.

## Verification evidence

Verify:
`npx vitest run tests/os/cLanguageControlFlow.test.ts tests/os/cFamilyProfiles.test.ts tests/runtime tests/os/toolchain.test.ts tests/os/assemblerProfiles.test.ts tests/computer/cs486DebuggerRuntime.test.ts`.

Expect: existing C/C++ profile-parity/determinism/rejection coverage stays
green; new coverage passes for if/else-if/else, while (incl. zero-iteration),
do-while (runs once even when false), break/continue in while/do/for (with `for`
still running its increment on `continue`), switch fallthrough,
duplicate-case/duplicate-default/break-outside-loop/continue-outside-loop
rejection, every comparison operator, bitwise/shift operators, logical-not,
genuine `&&`/`||` short-circuiting (a side-effecting call on the skipped side
must not execute), ternary (including nesting), and compile-twice byte-identical
determinism.

Result on 2026-07-20: 14 new tests passed
(`tests/os/cLanguageControlFlow.test.ts`); the full existing C-family suite (27
tests) and the complete `tests/runtime`/`tests/os/toolchain.test.ts`/
`tests/os/assemblerProfiles.test.ts`/`tests/computer/cs486DebuggerRuntime.test.ts`
set (257 tests) passed with zero regressions.

Verify: `npx vitest run` (complete suite).

Expect: all tests pass.

Result on 2026-07-20: 1419 tests passed, 0 failed.

Verify: `npm run test:pages`.

Expect: the updated Chapter 12.1 text builds and renders without errors.

Result on 2026-07-20: 3 files / 25 tests passed.

Verify: `npx tsc --noEmit -p .`.

Expect: no new type errors introduced by this change.

Result on 2026-07-20: clean for every file touched by this change. (One
pre-existing, unrelated type error exists in `pythonCs486.ts` from a separate,
already-in-progress Python 3.14 initiative - untouched by this Issue.)

Verify on 2026-07-21:
`rtk npm run test -- --run tests/runtime/cs486CCommonC11.test.ts tests/runtime/cs486CIntegers.test.ts tests/runtime/cs486CQualifiers.test.ts tests/runtime/cs486CPointers.test.ts tests/runtime/cs486CAggregates.test.ts tests/runtime/cs486CGlobals.test.ts tests/runtime/cs486CFunctionPointers.test.ts tests/runtime/cs486CVarargs.test.ts tests/runtime/cs486CLinkage.test.ts tests/runtime/cs486CFloat.test.ts tests/runtime/cs486ByteDataModel.test.ts tests/runtime/cs486Ir.test.ts tests/runtime/cs486Linker.test.ts tests/runtime/cs486Archive.test.ts tests/os/cLanguageControlFlow.test.ts tests/os/cFamilyProfiles.test.ts tests/os/toolchain.test.ts tests/os/staticArchiveToolchain.test.ts`.

Expect: the complete frontend, object/IR/linker/archive, data-model, and shell
integration corpus passes without host execution or partial output.

Result: PASS, 18 files / 146 tests.

Verify on 2026-07-21: `rtk npm run test:mcp:bds` and `rtk npm run validate`.

Expect: real BDS completes with zero diagnostics and the complete host gate
passes.

Result: PASS. BDS reported zero failures/diagnostics and final state `idle`; the
host gate passed 284 files / 2,142 tests, hosted-C archive freshness, pack
build, and all 16 Pages chapters.

## Real Web Terminal acceptance

Verify on 2026-07-21: start a fresh dedicated Issue #99 fixture, provision its
exact debug-owned CS-Linux Computer, create a source with recursive `fib`, an
array, and a struct through bounded guest commands, run `cc -c`, `ld`, and
`run`, then open the exact writer with `bds_open_web_terminal` and run the
executable again through Web Terminal input.

Expect: compilation and execution succeed through guest paths only, the exact
80x25 writer shows the correct result and a returned shell prompt, no secret or
token appears in evidence, and diagnostics remain zero.

Result: PASS. The fresh fixture Computer authenticated as `cs`; guest `cc -c`
used 679 modeled cycles, `ld` used 149, and `run` returned exit 0 with
`FIB_STRUCT=32` in 6,546 cycles. The same output and prompt return were observed
on the connected exact Web Terminal writer. Diagnostics were zero and BDS
stopped in `idle`; no password, token, handoff URL, or host compiler path was
recorded.
