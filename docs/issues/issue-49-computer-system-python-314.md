# Issue #49: Computer System Python 1.0 — Python 3.14 CS Profile

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/49

Status: accepted implementation epic; implementation is in progress. The current
language remains a bounded partial subset and is only targeting Python 3.14
syntax and core semantics.

## Boundary

- Preserve the direct Python-to-CS486 architecture and one validated
  `Cs486Process`; do not introduce a separate Python VM or scheduler.
- Implement the Python 3.14 grammar and observable core semantics within
  explicit parser, compiler, runtime, RAM, filesystem, I/O, and scheduler
  bounds.
- Build classes and the Python data model, closures, Unicode,
  arbitrary-precision integers, iterators, generators, context managers,
  packages, bounded dynamic code, exception groups, pattern matching,
  annotations/type parameters, template strings, and async protocols.
- Track built-ins and standard-library modules with explicit `compatible`,
  `guest-adapted`, or `unavailable` status.
- Keep CS386SX user Python unavailable with status 127 and keep native guest
  extensions on the versioned CS486OBJ path.

## Explicit exclusions

`pip`, `ensurepip`, `venv`, PyPI/wheel installation, CPython bytecode/`.pyc`,
JIT and free-threading/GIL implementation details, subinterpreters, the Python C
API, CPython `.so`/`.pyd` modules, and every host-escape path are outside the
profile.

## Acceptance

Verify: `npm run test:python314`.

Expect: the compatibility contract and all Python 3.14 conformance suites pass,
including bounded failure and resource-finalization cases.

Verify: `npm run validate`.

Expect: the complete host gate passes with the production pack and Pages build.

Verify: run the Python 3.14 CS Profile probe against a real isolated Bedrock
Dedicated Server, then inspect the field manual in real Chrome at desktop and
mobile viewport sizes.

Expect: supported CS486 profiles pass, CS386SX rejects with status 127, no
resource or process state leaks remain, the documented compatibility matrix is
accurate, and the browser reports no layout overflow or console errors.
