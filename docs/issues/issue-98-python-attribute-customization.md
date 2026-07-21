# Issue #98: bounded Python attribute customization and deletion

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/98>

- Status: implemented; focused, aggregate, full-host, real-browser, and real-BDS
  verified
- Date: 2026-07-21
- Profiles: Computer System Python 1.0 on CS486DX/CS486DX2
- Depends on: #49, #51, #52, #59, #74, #97

## Delivered contract

- `del` accepts names, attributes, built-in list/dictionary items, list slices,
  and nested list/tuple target lists. Scope analysis treats deleted names as
  assignments; runtime deletion proceeds left to right and a later fault retains
  earlier mutations.
- Inherited `__getattribute__` owns explicit instance reads. Only
  `AttributeError`, including a descriptor getter fault, enters inherited
  `__getattr__`. Inherited `__setattr__` and `__delattr__` own explicit writes
  and deletions.
- `object.__getattribute__`, `object.__setattr__`, and `object.__delattr__`
  provide default single-inheritance delegation. Data descriptors with `__set__`
  or `__delete__` retain precedence; property setters/deleters use the same
  path.
- `getattr`, `setattr`, and `delattr` support instances and ordinary
  class/namespace objects. A `getattr` default is published only after lookup
  and inherited `__getattr__` both end in `AttributeError`.
- Hook calls reuse ordinary synchronous managed CS486 call/return, exception
  routing, 64-call-depth admission, reachable heap roots, and outer instruction
  slices. AttributeError fallback reuses the original physical return address
  through an explicit jump owner; every success/fault path finalizes its frame,
  marker, stack, and pending-control ownership.

## Deliberate exclusions

- Multiple inheritance/C3, metaclasses, slots, `super`, class cells, and
  `__new__` remain separate data-model work.
- Module-level `__getattr__`/`__dir__`, metaclass attribute customization,
  user-defined `__delitem__`, arbitrary native/asynchronous attribute hooks,
  weak-reference finalizers, and object-lifetime `__del__` are not implemented.
- `pip`, PyPI, wheels, `venv`, and CPython extension ABIs remain excluded by the
  parent profile.

## Acceptance evidence

- Verify:
  `rtk proxy npx vitest run tests/language/deletionSyntax.test.ts tests/runtime/pythonDeletion.test.ts tests/runtime/pythonAttributeHooks.test.ts tests/runtime/pythonDescriptors.test.ts`
  Expect: syntax/scope, left-to-right deletion, descriptors/properties,
  inherited hooks, defaults, class APIs, invalid hooks, call depth, and
  low-slice cases pass.
- Verify: `rtk npm run test:python314` Expect: the Python 3.14 CS Profile
  aggregate includes deletion and attribute customization and exits
  successfully.
- Verify: `rtk npm test -- tests/runtime` Expect: all runtime suites pass
  without call-marker, physical return-address, heap-root, or descriptor
  regressions.
- Verify: a focused production Computer test executes hooks and deletion through
  the CS-Linux `python` command. Expect: output is correct and Guest RAM returns
  to its exact pre-command baseline.
- Verify: `rtk npm run test:web`, `rtk npm run test:pages`, and
  `rtk npm run build:pages` Expect: the canonical manual and static build expose
  the delivered behavior, limits, and exclusions.
- Verify: `rtk npm run test:mcp:bds` in a dedicated empty runtime. Expect:
  production pack load and headless guest-process probes finish with zero
  failures/diagnostics and final state `idle`.
- Verify: `rtk npm run validate` Expect: formatting, ESLint, TypeScript, all
  tests, production pack, and 16-chapter Pages build pass.

## Current result

- The attribute customization suite passes 5 tests; the contract, syntax,
  attribute, descriptor, and deletion selection passes 5 files and 32 tests.
- `rtk npm run test:python314` passes 65 files and 643 tests.
- Runtime passes 83 files and 681 tests; Computer passes 33 files and 207 tests;
  Web passes 7 files and 101 tests; Pages passes 3 files and 29 tests; all 16
  chapters build.
- Chrome verifies the generated Chapter 05 section at desktop and a temporary
  375 px viewport. Document client/scroll widths are 1,263/1,263 and 360/360;
  the section stays within 326 px, only its code example owns the intended
  324-to-565 px local scroll, and warnings/errors are zero. Viewport, tab,
  server PID, and port were finalized.
- The official MCP companion smoke runner used one dedicated empty runtime on
  BDS ports 19162/19163. The headless suite completed with zero failures, zero
  diagnostics, and final state `idle`; ports were released and the temporary
  runtime was removed.
- The final `rtk npm run validate` passes formatting, ESLint, TypeScript, all
  279 files and 2,102 tests, hosted-C consistency, the production Bedrock pack,
  and the 16-chapter Pages build.
