# Issue #97: bounded Python descriptors and method variants

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/97>

- Status: implemented; focused, aggregate, full-host, real-browser, and real-BDS
  verified
- Date: 2026-07-21
- Profiles: Computer System Python 1.0 on CS486DX/CS486DX2
- Depends on: #49, #51, #74, #75

## Delivered contract

- Instance reads use inherited data-descriptor, instance-attribute, inherited
  non-data-descriptor, then inherited class-value precedence. Managed functions
  remain non-data descriptors and bind only through class lookup.
- An inherited class-owned `__get__` receives its descriptor instance, the
  accessed instance or `None`, and the most-derived accessed class. An inherited
  `__set__` owns an instance write before any instance-map mutation.
- Class completion visits authored namespace values in order and invokes an
  inherited `__set_name__` exactly once. A bounded compiled step/resume
  trampoline supports zero, one, multiple, and nested class notifications; the
  class definition is published only after all notifications succeed.
- Intrinsic `property` supports getter/setter/deleter replacement, read-only
  `fget`/`fset`/`fdel`/`__doc__` reflection, class access returning the
  property, and explicit missing-accessor `AttributeError`. `staticmethod`
  preserves its wrapped value, while `classmethod` binds the most-derived
  accessed class.
- Bound methods expose stable `__self__` and `__func__`. Descriptor receivers,
  owner classes, pending stores, class-completion snapshots, wrappers, and bound
  methods stay reachable through `PythonHeapAccounting`.
- Descriptor calls and notifications reuse the ordinary managed CS486
  call/return, 64-call-depth admission, exception routing, rollback, and outer
  instruction-slice owner. Class namespaces retain the 4,096-entry ceiling and
  the single-base chain retains the 64-class ceiling.

## Deliberate exclusions

- Multiple inheritance/C3, metaclasses, `__getattribute__`/`__getattr__`,
  `__delete__`/`del`, `__slots__`, `super`, `__class__` cells, and `__new__`
  remain separate data-model work.
- Arbitrary native descriptors and asynchronous descriptor protocol methods are
  not part of this phase.
- Complete CPython descriptor reflection and the tuple form of
  `isinstance`/`issubclass` class information remain deferred.
- `pip`, PyPI, wheels, `venv`, and CPython extension ABIs remain excluded by the
  parent Python profile.

## Acceptance evidence

- Verify: `rtk vitest run tests/runtime/pythonDescriptors.test.ts` Expect:
  precedence, inheritance, class/instance access, ordered/nested set-name,
  property accessors, static/class methods, bound reflection, fault retry,
  synchronous rejection cleanup, call depth, exact/plus-one capacity, heap
  ownership, and low-slice cases pass.
- Verify:
  `rtk vitest run tests/runtime/pythonClasses.test.ts tests/runtime/pythonDecorators.test.ts tests/runtime/pythonDescriptors.test.ts`
  Expect: existing classes/decorators and descriptor extensions pass together.
- Verify: `rtk npm test -- tests/runtime` Expect: all runtime tests pass without
  class-return, call-marker, or heap regressions.
- Verify:
  `rtk vitest run tests/computer/computerHost.test.ts -t "runs descriptors"`
  Expect: the production CS-Linux `python` command executes descriptor behavior
  and returns Guest RAM to its exact pre-command baseline.
- Verify: `rtk npm run test:python314` Expect: the aggregate Python 3.14 CS
  Profile includes the descriptor suite and exits successfully.
- Verify: `rtk npm run test:web`, `rtk npm run test:pages`, and
  `rtk npm run build:pages` Expect: the canonical descriptor contract, limits,
  examples, and exclusions appear in the generated 16-chapter manual.
- Verify: inspect the generated Python chapter in a real browser at desktop and
  narrow mobile widths. Expect: the descriptor section is visible without
  document-level horizontal overflow or browser warnings/errors.
- Verify: `rtk npm run test:mcp:bds` in a dedicated empty BDS runtime. Expect:
  production pack load and the headless guest-process suite finish with zero
  failures/diagnostics and final state `idle`.
- Verify: `rtk npm run validate` Expect: formatting, lint, TypeScript, all
  tests, hosted-C consistency, the production Bedrock pack, and the 16-chapter
  Pages build pass.

## Verification result

- The dedicated descriptor suite currently passes 11 tests. The combined
  descriptor, production command, compatibility-contract, and canonical-manual
  selection passes 51 tests.
- `rtk npm run test:python314` passes 62 files and 627 tests. The complete
  runtime selection passes 81 files and 672 tests.
- The complete Computer aggregate selection passes 33 files and 207 tests. Web
  passes 7 files and 101 tests, Pages passes 3 files and 29 tests, and all 16
  chapters build.
- An earlier headed Playwright check verified Chapter 05 at 1,263 px and 390 px
  viewports with equal client/scroll widths and zero warnings/errors. A later
  Chrome check verified the generated Python chapter in the default desktop
  viewport and at a temporary 375 px viewport: desktop document client/scroll
  widths were both 1,263 px; mobile widths were both 360 px; the descriptor
  section stayed within 326 px; and only its code example owned the intended
  local 324-to-565 px horizontal scroll. Chrome warnings/errors were zero. The
  viewport was reset, tabs finalized, local server stopped, and port 4177
  released.
- Dedicated empty runtimes passed twice: Web/BDS ports 4180/19156/19157 and
  4176/19152/19153 both ended with zero headless failures, zero diagnostics, and
  final state `idle`. Every port was released and both temporary runtimes were
  removed.
- `rtk npm run validate` passes formatting, ESLint, TypeScript, all 276 files
  and 2,086 tests, hosted-C consistency, the production Bedrock pack, and the
  16-chapter Pages build.
