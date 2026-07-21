# Issue #74: Python classes, instances, and single inheritance

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/74

Status: Phase 12 implementation, focused verification, and the Python aggregate
suite are complete. The repository-wide host gate and final real-BDS/browser
profile gate are recorded separately below.

Depends on: Epic #49 and Issues #50 through #57, #59, and #66 through #68.

## Boundary

- Parse executable `class` suites with zero or one runtime base. An omitted base
  uses `object`; authored multiple-base syntax is parsed and rejected explicitly
  by the current compiler profile.
- Evaluate bases in the enclosing scope, execute the suite in an isolated class
  namespace, and publish the class binding only after successful completion.
- Keep class locals out of method lexical closure binding while forwarding
  enclosing function cells through the class frame, including same-name lookup
  before a class-local assignment.
- Model bounded class, instance, and bound-method runtime values. Attribute
  lookup visits the instance namespace, class namespace, then one base chain. A
  managed Python function binds only when found through the class path on an
  instance.
- Calling a class allocates an accounted instance, invokes inherited `__init__`
  through the existing Python call/return path, requires a `None` return, and
  exposes the instance only after successful initialization.
- Provide the foundational `object`, `isinstance`, and `issubclass` built-ins.
  Classes expose `__name__` and `__base__`; instances expose `__class__`. Class
  and instance namespaces share the default 4,096-entry collection ceiling and
  reachable managed-heap accounting.

The class/base lookup cost is O(D), where D is the bounded single-inheritance
depth with a fixed maximum of 64 classes including `object`. Namespace lookup
and mutation are average O(1). Reachable heap scans remain pressure-triggered
and visit each class, instance, method, and shared object once.

## Explicit exclusions

Multiple inheritance and C3 linearization, metaclasses, class decorators, type
parameters, descriptors, `property`, `__slots__`, `super`, `__class__` cells,
`__new__`, custom attribute hooks, operator protocols, `pip`, and `venv` remain
outside this phase. The foundational `isinstance` and `issubclass` forms accept
one class, not a tuple of classes.

## Acceptance

Verify:
`rtk proxy node .\\node_modules\\vitest\\vitest.mjs run tests\\language\\classes.test.ts tests\\language\\scope.test.ts tests\\language\\nameBinding.test.ts tests\\runtime\\pythonClasses.test.ts tests\\runtime\\pythonHeapAccounting.test.ts tests\\tools\\python314Compatibility.test.mjs`.

Expect: class AST and scope analysis, enclosing-cell pass-through, atomic
publication, method binding, instance shadowing, inherited lookup and
initialization, caller-owned initializer faults, built-ins, introspection
attributes, exact/capacity-plus-one namespaces, inheritance depth 64/65,
reachable heap accounting, and the manifest contract pass.

Verify: `rtk npm run test:python314`.

Expect: every class test and all earlier Python 3.14 CS Profile regressions
pass.

Verify: `rtk npm run validate`.

Expect: formatting, ESLint, TypeScript, every host test, the production Bedrock
pack, and the 16-chapter Pages build pass.

Official references:

- <https://docs.python.org/3.14/reference/compound_stmts.html#class-definitions>
- <https://docs.python.org/3.14/reference/datamodel.html#custom-classes>
- <https://docs.python.org/3.14/reference/datamodel.html#class-instances>
- <https://docs.python.org/3.14/reference/datamodel.html#instance-methods>

## Local verification result

- Focused class/scope/runtime/heap/contract verification passed: 6 files and 41
  tests.
- `rtk npm run test:python314` passed: 31 files and 279 tests.
- Focused ESLint passed. The repository-wide gate is presently waiting for the
  concurrently edited C frontend to supply `parseGlobalDeclaration`, one
  `CVariable.storage` field, and one terminal return. Formatting and scoped
  `git diff --check` pass; these are not Python-class failures.
- Class publication performs an exact transient reachable-heap preflight after
  removing the class frame and before binding the name, so rejection cannot
  expose a partial class or double-count its namespace.
- The independent all-Vitest run passed 212 files/1,539 tests and reported three
  unrelated failures in the incomplete C/toolchain path, a stale CS486OBJ v2
  listing expectation, and a changed boot-error suffix.
- Real Bedrock and real-browser conformance remain part of the final Python 3.14
  profile gate; this phase does not make the final compatibility claim.
