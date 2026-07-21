# Issue #102: bounded Python `__new__` construction protocol

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/102>

- Status: implemented; focused, aggregate, full-host, real-browser, and real-BDS
  verified
- Date: 2026-07-21
- Profiles: Computer System Python 1.0 on CS486DX/CS486DX2
- Depends on: #49, #51, #74, #97, #100, #101

## Delivered contract

- A class call resolves inherited `__new__` through the class's one canonical
  bounded C3 MRO. A plain managed `def __new__` is converted to the
  Python-special implicit-static form before the class is published.
- Custom construction receives the requested class followed by the original
  positional and keyword arguments exactly once. `object.__new__(cls)` strictly
  accepts one runtime class and allocates a heap-accounted bare instance.
- If custom `__new__` returns an instance of the requested class or a subclass,
  construction resolves `__init__` from the returned instance's class, forwards
  the original arguments, and requires a `None` result. Any other value is
  returned unchanged without initialization.
- The custom-new result and constructor arguments remain rooted across the
  existing compiled after-call trampoline. Nested calls, faults, call-depth
  rejection, and low instruction slices therefore retain one explicit
  finalization owner without introducing another VM or scheduler.
- Bare instance allocation and every newly published global/local binding
  preflight the reachable managed heap. Capacity rejection faults before the
  destination name is published and preserves earlier bindings.
- The production CS-Linux Python path exercises cooperative `super().__new__`,
  subclass results, and exact non-instance returns while retaining the existing
  Guest RAM baseline.

## Deliberate exclusions

- Metaclasses, `__slots__`, dynamic bases, `__mro_entries__`, operator
  construction protocols, object-lifetime `__del__`, and CPython allocation
  internals remain separate data-model work.
- Module/metaclass attribute hooks, arbitrary native or asynchronous
  descriptors/hooks, and user-defined native allocation remain deferred.
- `pip`, `ensurepip`, PyPI, wheels, `venv`, and CPython extension ABIs remain
  excluded by the parent Python 3.14 CS Profile.

## Acceptance evidence

- Verify: `rtk npm test -- --run tests/runtime/pythonNew.test.ts` Expect:
  default/direct allocation, implicit-static binding, C3 selection, exact
  argument forwarding, subclass/non-instance results, nested/fault ownership,
  heap rejection, depth recovery, and low slices pass.
- Verify:
  `rtk npm test -- --run tests/runtime/pythonNew.test.ts tests/runtime/pythonClasses.test.ts tests/runtime/pythonMultipleInheritance.test.ts tests/runtime/pythonSuper.test.ts tests/runtime/pythonDescriptors.test.ts tests/runtime/pythonHeapAccounting.test.ts tests/runtime/pythonAssignments.test.ts`
  Expect: the constructor protocol introduces no class, C3, descriptor, heap, or
  assignment regression.
- Verify: `rtk npm run test:python314` and `rtk npm test -- --run tests/runtime`
  Expect: the Python profile and runtime aggregates include the new constructor
  suite and exit successfully.
- Verify: `rtk npm test -- --run tests/computer` Expect: production CS-Linux
  Python executes cooperative custom construction and returns Guest RAM to its
  exact pre-command baseline.
- Verify: `rtk npm run test:web`, `rtk npm run test:pages`, and
  `rtk npm run build:pages` Expect: the canonical and static manuals expose C3
  selection, implicit-static `__new__`, strict `object.__new__`, and the
  result-dependent initializer contract.
- Verify: Chrome opens generated Chapter 05 at desktop and 360 px mobile
  breakpoints. Expect: required construction text is visible, document and
  reader widths do not overflow, long code owns only local scrolling, the stale
  `__new__` exclusion is absent, and console warnings/errors are zero.
- Verify: `rtk npm run test:mcp:bds` with an empty dedicated `BDS_MCP_WORKDIR`,
  free BDS port pair, and free Web port. Expect: pack/probe work completes with
  zero failures/diagnostics and final state `idle`.
- Verify: `rtk npm run validate` Expect: formatting, ESLint, TypeScript, all
  tests, production pack, and the 16-chapter Pages build pass.

## Current result

- The dedicated constructor suite passes 8 tests. The focused class/C3/super/
  descriptor/heap/assignment selection passes 7 files and 67 tests; the wider
  contract/manual/Computer selection passes 10 files and 108 tests.
- `rtk npm run test:python314` passes 68 files and 673 tests. Runtime passes 86
  files and 710 tests; Computer passes 33 files and 208 tests.
- Web passes 7 files and 101 tests; Pages passes 3 files and 29 tests, and all
  16 chapters build.
- Chrome desktop reports document 1,485/1,485 px and reader 1,118/1,118 px. At
  the 360 px override, document width is 360/360 px and reader width is 358/358
  px; 9 of 62 code blocks own local horizontal scrolling. All required
  construction checks are present, the stale exclusion is absent, and browser
  warnings/errors are zero. The tab was finalized and the temporary server was
  stopped with its port released.
- The official MCP companion used one dedicated empty runtime on BDS ports
  19268/19269 and Web port 18102. The headless suite completed with zero
  failures, zero diagnostics, and final state `idle`; all ports were released
  and the temporary runtime was removed.
- The first final gate stopped only because runtime guidance reached 207 lines
  against its 200-line scope limit. Consolidating the new responsibility to 200
  lines made the focused guidance test pass 5/5.
- The final `rtk npm run validate` passes formatting, ESLint, TypeScript, all
  282 files and 2,133 tests, hosted-C consistency, the production Bedrock pack,
  and the 16-chapter Pages build.
