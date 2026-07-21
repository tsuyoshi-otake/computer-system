# Issue #84: bounded Python regular packages and import semantics

Issue: <https://github.com/tsuyoshi-otake/computer-system/issues/84>

## Implemented contract

- Dotted imports, aliases, absolute and explicit-relative `from` imports,
  parenthesized selected-name lists, and module-level wildcard imports.
- Regular guest source packages marked by `__init__.py`, with package precedence
  over a same-name `.py` module.
- Parent-before-child initialization, module-once caching, child publication,
  top-level dotted binding, and alias leaf binding.
- Stable `__name__`, `__package__`, `__file__`, and package `__path__` metadata
  before authored module code executes.
- Exact partially initialized namespaces for ordinary cycles and removal of an
  incomplete module plus child publication when initialization escapes with a
  fault, allowing deterministic retry.
- Fixed graph ceilings of 64 modules including `__main__`, import depth 16, and
  512,000 aggregate UTF-8 source bytes, in addition to the existing frontend,
  call-depth, managed-heap, CS486 instruction, and scheduler budgets.
- Namespace packages, zip imports, dynamic import hooks, `pip`, and `venv`
  remain unavailable profile boundaries.

## Acceptance evidence

### Parser and scope

Verify:
`rtk proxy node .\node_modules\vitest\vitest.mjs run tests/language/parser.test.ts tests/language/scope.test.ts --reporter dot`

Expect: every supported import form parses and binds correctly; invalid
relative, comma, and non-module wildcard forms fail deterministically.

### Runtime packages and bounds

Verify:
`rtk proxy node .\node_modules\vitest\vitest.mjs run tests/runtime/pythonPackages.test.ts tests/runtime/pythonCs486.test.ts --reporter dot`

Expect: regular package precedence, initialization order, binding, metadata,
wildcard selection, cycles, failure rollback/retry, exact capacity, depth,
source-size, call-depth, and bounded-slice cases pass.

### Contract and manual

Verify:
`rtk proxy node .\node_modules\vitest\vitest.mjs run tests/tools/python314Compatibility.test.mjs tests/tools/webManual.test.mjs --reporter dot`

Expect: the machine-readable contract and field manual agree about supported
regular packages, limits, and unavailable import mechanisms without claiming
complete Python 3.14 compatibility.

### Aggregate gates

Verify: `rtk npm run test:python314`

Expect: every current Python 3.14 CS Profile test passes, including the package
suite.

Verify: `rtk npm run validate`

Expect: formatting, lint, TypeScript, all host tests, the production pack, and
all 16 Pages chapters pass. Real-browser evidence is recorded after this gate is
green.

## Current verification state

The final focused parser, scope, package, and existing-runtime selection passed
4 files and 41 tests. The full Python profile passed 42 files and 418 tests; the
Web suite passed 7 files and 101 tests; Pages passed 3 files and 26 tests and
the Pages builder emitted all 16 chapters. TypeScript and ESLint both passed
after the shared iterable-materialization runtime was reconciled.

Configured Chrome verification loaded `/manual/#chapter-micropython` at 1440x900
and 390x844. Both sizes displayed the regular-package heading, `__init__.py`
rule, dotted-binding example, graph limits, and unavailable namespace/zip/hook
mechanisms with no horizontal overflow and no console warning or error. The
viewport overrides, tabs, and the exact local-server process were finalized.

The aggregate `npm run validate` reached all 243 host test files and 1,784
tests. After the Python resolver and instruction-count regressions were fixed,
remaining failures are concurrent C/C++ frontend, global-relocation,
hosted-libc, and linker expectations. No package/import test remains failing, so
Issue #84 stays open only until the repository-wide aggregate gate is green.
