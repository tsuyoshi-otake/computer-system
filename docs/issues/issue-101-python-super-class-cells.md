# Issue #101: bounded Python `super` and `__class__` cells

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/101>

- Status: implemented; focused, aggregate, full-host, real-browser, and real-BDS
  verified
- Date: 2026-07-21
- Profiles: Computer System Python 1.0 on CS486DX/CS486DX2
- Depends on: #49, #51, #52, #74, #97, #98, #100

## Delivered contract

- A function or lambda that uses the unshadowed builtin `super` receives one
  implicit hidden `__class__` closure cell. Authored outer, class-body, local,
  and parameter bindings named `__class__` remain separate and retain their
  normal lexical meaning.
- Class completion initializes that cell only after direct bases, the canonical
  C3 MRO, and heap admission succeed. A later `__set_name__` failure clears the
  cell before the partially constructed class is abandoned.
- `super()` uses the hidden class cell and first bound argument; `super(type)`
  creates an unbound proxy; and `super(type, instance-or-subclass)` validates
  the receiver against the same canonical C3 hierarchy.
- Proxy lookup starts strictly after the requested class in the receiver's C3
  MRO and reuses ordinary managed-function, property, custom-descriptor, and
  classmethod binding. The 64-entry MRO bound remains authoritative.
- Stable read-only `__thisclass__`, `__self__`, and `__self_class__` reflection
  expose proxy state. The root `object.__init__` supports terminal cooperative
  initialization without weakening ordinary constructor argument rejection.
- Hidden cells, proxies, active and suspended frames, callables, annotations,
  and lazy evaluators remain visible to `PythonHeapAccounting`. Heap rejection,
  call-depth faults, and low instruction slices end through explicit existing
  finalization paths.
- Compilation remains direct to CS486. No second Python VM or scheduler was
  introduced.

## Deliberate exclusions

- Metaclasses, `__slots__`, `__new__`, dynamic `__bases__` reassignment, and
  custom `__mro_entries__` or generic-base rewriting remain separate data-model
  work.
- Custom operator protocols, module/metaclass attribute hooks, arbitrary native
  or asynchronous descriptors/hooks, user-defined `__delitem__`, and
  object-lifetime `__del__` remain deferred.
- `pip`, PyPI, wheels, `venv`, and CPython extension ABIs remain excluded by the
  parent Python 3.14 CS Profile.

## Acceptance evidence

- Verify:
  `rtk npm test -- tests/language/classes.test.ts tests/runtime/pythonSuper.test.ts tests/runtime/pythonClasses.test.ts tests/runtime/pythonMultipleInheritance.test.ts tests/runtime/pythonDescriptors.test.ts tests/runtime/pythonHeapAccounting.test.ts`
  Expect: hidden-cell scope, all three `super` forms, cooperative diamonds,
  descriptor binding, reflection, `object.__init__`, failed completion,
  exact/plus-one limits, heap admission, depth recovery, and low instruction
  slices pass.
- Verify: `rtk npm run test:python314` Expect: the Python 3.14 CS Profile
  aggregate includes the dedicated `super` suite and exits successfully.
- Verify: `rtk npm test -- tests/runtime` Expect: all runtime suites pass with
  no descriptor, iterator, generator, typing, heap-root, or class-call
  regressions.
- Verify: `rtk npm test -- tests/computer` Expect: production CS-Linux Python
  executes a cooperative diamond and exact Guest RAM returns to its pre-command
  baseline.
- Verify: `rtk npm run test:web`, `rtk npm run test:pages`, and
  `rtk npm run build:pages` Expect: canonical and static manuals expose the
  hidden-cell, proxy, C3, reflection, and `object.__init__` contract.
- Verify: Chrome opens generated Chapter 05 at desktop and 360 px mobile
  breakpoints. Expect: the `super`/class-cell contract is visible, document and
  article widths do not overflow, long code owns only local scrolling, and
  console warnings/errors are zero.
- Verify: `rtk npm run test:mcp:bds` with an empty dedicated `BDS_MCP_WORKDIR`,
  free BDS port pair, and free Web port. Expect: pack/probe work completes with
  zero failures/diagnostics and final state `idle`.
- Verify: `rtk npm run validate` Expect: formatting, ESLint, TypeScript, all
  tests, production pack, and 16-chapter Pages build pass.

## Current result

- The dedicated `super` suite passes 9 tests; the focused language/class/C3/
  descriptor/heap selection passes 6 files and 57 tests.
- `rtk npm run test:python314` passes 67 files and 665 tests. Runtime passes 85
  files and 702 tests; Computer passes 33 files and 208 tests.
- Web passes 7 files and 101 tests; the contract/manual selection passes 2 files
  and 21 tests; Pages passes 3 files and 29 tests, and all 16 chapters build.
- Chrome desktop reports document 1,260/1,260 px and article 938/938 px. At the
  360 px override, document width is 360/360 px and article width is 358/358 px;
  9 of 15 long code blocks own local horizontal scrolling. All six required
  `super`/class-cell checks are present and browser warnings/errors are zero.
  The viewport was reset, the tab finalized, and the temporary server stopped.
- The official MCP companion used one dedicated empty runtime on BDS ports
  19266/19267 and Web port 18101. The headless suite completed with zero
  failures, zero diagnostics, and final state `idle`; all ports were released
  and the temporary runtime was removed.
- The final `rtk npm run validate` passes formatting, ESLint, TypeScript, all
  281 files and 2,125 tests, hosted-C consistency, the production Bedrock pack,
  and the 16-chapter Pages build.
