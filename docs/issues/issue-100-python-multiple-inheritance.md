# Issue #100: bounded Python multiple inheritance and C3 MRO

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/100>

- Status: implemented; focused, aggregate, full-host, real-browser, and real-BDS
  verified
- Date: 2026-07-21
- Profiles: Computer System Python 1.0 on CS486DX/CS486DX2
- Depends on: #49, #51, #74, #86, #97, #98

## Delivered contract

- Class definitions evaluate zero or more direct bases exactly once from left to
  right before the class body; an omitted base uses `object`. A non-class base
  fails before body entry.
- Successful class bodies enter one bounded C3 merge. Duplicate or inconsistent
  bases raise catchable `TypeError` after body effects but before class
  publication, so an earlier definition binding remains intact.
- Every runtime class retains its direct bases and canonical MRO. Stable
  read-only `__base__`, `__bases__`, and `__mro__` reflection exposes that same
  state; one MRO admits at most 64 classes including the new class and `object`.
- Ordinary instance/class attributes, data and non-data descriptors,
  `__set_name__`, attribute hooks, implicit special methods, class patterns,
  `isinstance`, and `issubclass` use the same C3 order. Generic class
  definitions enter the same path.
- Direct-base admission and C3 construction are bounded before unbounded work.
  Base/MRO tuples and every referenced class are retained through
  `PythonHeapAccounting`; memory rejection does not publish the new class.
- Compilation remains direct to CS486. No second Python VM or scheduler was
  introduced, and the existing call/return, exception, instruction-slice, and
  Guest RAM finalization paths remain authoritative.

## Deliberate exclusions

- Metaclasses, `super`, `__class__` cells, `__slots__`, `__new__`, dynamic
  `__bases__` reassignment, and custom `__mro_entries__`/generic base rewriting
  remain separate data-model work.
- Custom operator protocols, module/metaclass attribute hooks, arbitrary native
  or asynchronous descriptors/hooks, user-defined `__delitem__`, and
  object-lifetime `__del__` remain deferred.
- `pip`, PyPI, wheels, `venv`, and CPython extension ABIs remain excluded by the
  parent Python 3.14 CS Profile.

## Acceptance evidence

- Verify:
  `rtk npm test -- tests/runtime/pythonClasses.test.ts tests/runtime/pythonMultipleInheritance.test.ts tests/runtime/pythonDescriptors.test.ts tests/runtime/pythonAttributeHooks.test.ts tests/runtime/pythonHeapAccounting.test.ts`
  Expect: base order, diamond lookup, C3 reflection, duplicate/inconsistent
  faults, descriptors, hooks, special methods, pattern matching, generic
  classes, subclass checks, exact/plus-one bounds, heap admission, and low
  instruction slices pass.
- Verify: `rtk npm run test:python314` Expect: the Python 3.14 CS Profile
  aggregate includes the dedicated multiple-inheritance suite and exits
  successfully.
- Verify: `rtk npm test -- tests/runtime` Expect: all runtime suites pass with
  no descriptor, iterator, pattern, generic, heap-root, or class-call
  regressions.
- Verify: `rtk npm test -- tests/computer` Expect: production CS-Linux Python
  executes a diamond hierarchy and exact Guest RAM returns to its pre-command
  baseline.
- Verify: `rtk npm run test:web`, `rtk npm run test:pages`, and
  `rtk npm run build:pages` Expect: canonical and static manuals expose C3,
  reflection, limits, and remaining exclusions.
- Verify: Chrome opens generated Chapter 05 at desktop and 360 px mobile
  breakpoints. Expect: the C3 contract is visible, document/section widths do
  not overflow, long code owns only local scrolling, and console warnings/errors
  are zero.
- Verify: `rtk npm run test:mcp:bds` with an empty dedicated `BDS_MCP_WORKDIR`
  and free port pair. Expect: pack/probe work completes with zero
  failures/diagnostics and final state `idle`.
- Verify: `rtk npm run validate` Expect: formatting, ESLint, TypeScript, all
  tests, production pack, and 16-chapter Pages build pass.

## Current result

- The dedicated C3 suite passes 12 tests; the focused class/C3/descriptor/hook/
  heap selection passes 5 files and 49 tests.
- `rtk npm run test:python314` passes 66 files and 655 tests. Runtime passes 84
  files and 693 tests; Computer passes 33 files and 208 tests.
- Web passes 7 files and 101 tests; the dedicated manual suite passes 16 tests;
  Pages passes 3 files and 29 tests, and all 16 chapters build.
- Chrome desktop reports document 1,265/1,265 px and the class section 789/789
  px. At the 360 px override, document width is 345/345 px and the class section
  311/311 px; its code examples own local 309-to-565 and 309-to-375 px
  scrolling. The C3, `__bases__`, `__mro__`, and 64-entry text is present and
  browser warnings/errors are zero. The viewport was reset, the tab finalized,
  and the temporary server stopped.
- The official MCP companion used one dedicated empty runtime on BDS ports
  19164/19165. The headless suite completed with zero failures, zero
  diagnostics, and final state `idle`; both ports were released and the
  temporary runtime was removed.
- The final `rtk npm run validate` passes formatting, ESLint, TypeScript, all
  280 files and 2,115 tests, hosted-C consistency, the production Bedrock pack,
  and the 16-chapter Pages build.
