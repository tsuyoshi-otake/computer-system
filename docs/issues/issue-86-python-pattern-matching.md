# Issue #86: bounded Python structural pattern matching

Issue: <https://github.com/tsuyoshi-otake/computer-system/issues/86>

## Implemented contract

- `match`, `case`, and `_` remain soft keywords; ordinary assignments to `match`
  and `case` continue to parse.
- One evaluate-once subject, top-to-bottom cases, and guards evaluated only
  after a complete successful pattern.
- Literal/singleton, dotted value, capture/wildcard, OR/AS, fixed/starred
  list-or-tuple sequence, built-in dictionary mapping/rest, and
  single-inheritance class patterns.
- Class positional attributes use inherited `__match_args__`; keyword attributes
  use the existing instance/class lookup path. A missing attribute means no
  match, while other faults propagate.
- Captures from a failed pattern or failed OR alternative remain private. A
  complete success passes one heap/namespace preflight and publishes every name
  before its guard. Successful captures remain bound after a false or faulting
  guard, matching Python-observable ordering.
- Parser limits cover pattern nesting and construct items; compilation admits at
  most 4,096 pattern nodes per case. Each case is one bounded managed operation
  whose measured work contributes to CS486 cycle debt.
- Custom sequence/mapping protocols, descriptor/metaclass customization, and
  multiple-inheritance/C3 matching remain explicit profile exclusions.

## Acceptance evidence

### Parser and scope

Verify:
`rtk vitest run tests/language/patternMatching.test.ts tests/language/parser.test.ts tests/language/scope.test.ts`

Expect: all supported AST forms and soft-keyword assignments parse; pattern
references/captures classify correctly; duplicate captures/keys, unequal OR
bindings, multiple stars, unreachable cases, and capacity-plus-one fail before
code generation.

### Runtime semantics and bounded control flow

Verify:
`rtk vitest run tests/runtime/pythonPatternMatching.test.ts tests/language/patternMatching.test.ts`

Expect: evaluate-once ordering, guards, atomic captures, failed-OR rollback,
star/rest ownership, inherited class matching, dynamic faults, body control-flow
cleanup, and small CS486 slices pass.

### Contract and manual

Verify:
`rtk vitest run tests/tools/python314Compatibility.test.mjs tests/tools/webManual.test.mjs`

Expect: the manifest and manual state the same supported patterns, binding
rules, limits, and exclusions without claiming full Python 3.14 compatibility.

### Aggregate gates

Verify: `rtk npm run test:python314`

Expect: every current Python 3.14 CS Profile test passes, including structural
pattern matching.

Verify: `rtk npm run validate`

Expect: formatting, lint, TypeScript, all host tests, the production pack, and
all 16 Pages chapters pass. A real-browser check follows a green authored Pages
build.

## Current verification state

The focused parser/scope selection passed 21 tests. Structural runtime coverage
now passes 8 tests, including capacity failure before any capture publication;
the final parser/scope/runtime/contract/manual selection passes 6 files and 47
tests. Web passes 7 files and 101 tests, Pages passes 3 files and 26 tests, and
the Pages builder emits all 16 chapters.

Configured Chrome loaded `/manual/#chapter-micropython` at exact 1440x900 and
390x844 emulated viewports. Both sizes displayed the structural-pattern heading,
soft-keyword rule, atomic capture and guard ordering, and 4,096-node limit with
no document-level horizontal overflow and no console warning/error. The viewport
override, tab, and exact local-server PID 81204 were finalized.

The aggregate `npm run validate` passes formatting, ESLint, and TypeScript, then
reaches 242/247 test files and 1,799/1,811 tests. All 12 residual failures are
in concurrent C/C++ frontend diagnostics, relocations, hosted `printf`, linker
data layout, and Python CS486OBJ extension placement; no structural-pattern test
fails. A later aggregate import attempt encountered an in-flight hosted-libc
`buildCursesHeader` reference before collecting tests, so Issue #86 remains open
until the stable repository-wide gate is green.
