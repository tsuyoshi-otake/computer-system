# Issue #79: Python generator throw and close semantics

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/79

Status: host implementation, focused acceptance, aggregate repository gate, and
manual-browser verification complete. Later generator protocols and the final
Python 3.14 profile gate remain open.

Depends on: Epic #49 and Issues #53, #76, #77, and #78.

## Boundary

- Yield is accepted throughout `try`, `except`, `else`, and `finally`. A
  suspension retains active exception handlers, handled faults, pending return /
  jump / fault / finalizer control, locals, cells, the managed value-stack
  suffix, and the next CS486 target.
- `generator.throw(exception)` injects at the suspended yield, returns the next
  yielded value when caught, closes and propagates an uncaught or replacement
  fault, and preserves the supplied exception instance. The legacy type/value
  form accepts an omitted or `None` traceback; a modeled traceback object
  remains unavailable.
- `generator.close()` injects `GeneratorExit`. Escaping `GeneratorExit` and
  normal return succeed, a handled return value is returned, a yielded value
  closes and raises `RuntimeError`, and another fault propagates. Created and
  closed close calls are stable and do not execute the body.
- `GeneratorExit` is matched as a direct `BaseException`, not by `Exception`.
  Escaping `StopIteration` from a generator body becomes `RuntimeError`.
- Every generator method rejects running re-entry with `ValueError`. Invalid
  signatures and capacity-plus-one admission fail before consuming the
  generator.
- Suspended exception/control values and stored bound `send`, `throw`, and
  `close` receivers remain in the existing reachable `PythonHeapAccounting`
  graph. The implementation adds no Python VM, scheduler, instruction pointer,
  continuation queue, or physical RAM lease.

## Explicit deferrals

`yield from`, generator expressions, automatic garbage-collection close, custom
iterator methods, context managers, asynchronous generators, and the excluded
packaging/CPython ABI surfaces remain later work.

## Acceptance

Verify:
`rtk proxy node .\node_modules\vitest\vitest.mjs run tests/language/generators.test.ts tests/runtime/pythonGenerators.test.ts tests/runtime/pythonHeapAccounting.test.ts`.

Expect: yield in every exception suite,
caught/uncaught/replacement/initial/closed throw, exact exception identity,
handled-fault retention and bare re-raise, return/fault continuation across
finally yields, every close terminal path, `GeneratorExit` hierarchy,
`StopIteration` conversion, re-entry, invalid legacy forms, capacity-plus-one
rejection, and heap reachability pass.

Verify: `rtk npm run test:python314` and `rtk npm run validate`.

Expect: every prior Python 3.14 CS Profile regression, all host tests, the
production Bedrock pack, and the 16-chapter Pages build pass.

Verify: open the built `manual/#chapter-micropython` in a real browser at
desktop and 390-pixel widths, inspect the console, and confirm the generator
section documents `throw`, `close`, and `GeneratorExit` without changing the
stable chapter link.

Expect: both viewports have no horizontal overflow, the chapter remains active,
and no page-script warning or exception is reported.

Official references:

- https://docs.python.org/3.14/reference/expressions.html#generator-iterator-methods
- https://docs.python.org/3.14/library/exceptions.html#GeneratorExit

## Local verification result

- Focused syntax/runtime/heap acceptance passed 3 files and 45 tests on
  2026-07-20.
- The synchronized contract/manual run passed 5 files and 64 tests, and
  `rtk npm run test:python314` passed 36 files and 330 tests.
- `rtk npm run validate` passed formatting, ESLint, TypeScript, all 227 test
  files and 1,649 tests, the production Bedrock pack, and the 16-chapter Pages
  build.
- Chrome opened the built manual at `#chapter-micropython`. At 1440x900 and
  390x844 it retained the exact title/hash, displayed `throw(exception)`,
  `close()`, `GeneratorExit`, and the `try`/`except`/`finally` suspension
  contract, and had no horizontal overflow. The console contained no warning or
  error. The temporary viewport, tab, and exact loopback-server process were
  finalized.
