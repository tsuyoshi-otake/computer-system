# Issue #78: Python generator send semantics

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/78

Status: host implementation complete; aggregate validation and manual-browser
acceptance are recorded below. Later generator protocols and the final Python
3.14 profile gate remain open.

Depends on: Epic #49 and Issues #53, #76, and #77.

## Boundary

- Optional-value yield expressions are accepted as the sole unparenthesized
  assignment RHS and in parenthesized expression positions. Direct yield in a
  `def` or `lambda` owns that generator; comprehension implicit scopes, module
  and class scopes, active exception handlers, and `yield from` fail explicitly.
- `next(generator)`, `for`, and `generator.send(None)` resume through the same
  CS486 call target and make the suspended yield expression evaluate to `None`.
  `generator.send(value)` supplies that exact managed value and returns the next
  yielded value.
- A non-`None` send to a created generator raises `TypeError` without executing
  or consuming it. Bad arity, keywords, call-capacity rejection, running
  re-entry, stable exhaustion, return, and escaping faults each preserve one
  observable state owner.
- A stored bound `send` method retains its generator. Sent values, locals,
  cells, the suspended value-stack suffix, and the resume target remain in the
  existing reachable managed heap.
- Execution still uses the one `Cs486Process`, its instruction slicing, call
  depth, cycle debt, managed quota, and physical RAM lease. There is no Python
  VM, second instruction pointer, scheduler, or lease.

## Explicit deferrals

`throw`, `close`, `GeneratorExit`, `yield from`, generator expressions, yield
under an active `try`/`except`/`finally` handler, custom iterator methods,
context managers, async iteration, and the excluded packaging/CPython ABI
surfaces remain later work.

## Acceptance

Verify:
`rtk proxy node .\node_modules\vitest\vitest.mjs run tests/language/generators.test.ts tests/runtime/pythonGenerators.test.ts tests/runtime/pythonHeapAccounting.test.ts`.

Expect: AST and scope ownership, valid/invalid yield-expression contexts, exact
sent-value identity, `next`/`send(None)` equivalence, lambda and closure state,
first-send/capacity/re-entry rejection without corruption, stable exhaustion,
fault closure, and stored-method heap reachability pass.

Verify: `rtk npm run test:python314` and `rtk npm run validate`.

Expect: every prior Python 3.14 CS Profile regression, all host tests, the
production Bedrock pack, and the 16-chapter Pages build pass.

Verify: open the built `manual/#chapter-micropython` in a real browser at
desktop and 390-pixel widths, inspect the console, and confirm the generator
section documents `send` without changing the stable chapter link.

Expect: both viewports have no horizontal overflow, the chapter remains active,
and no page-script warning or exception is reported.

Official reference:
<https://docs.python.org/3.14/reference/expressions.html#generator-iterator-methods>

## Local verification result

- Focused syntax/runtime/heap acceptance passed 3 files and 33 tests.
- `rtk npm run test:python314` passed 36 files and 317 tests.
- `rtk npm run validate` passed formatting, ESLint, TypeScript, all 226 test
  files and 1,621 tests, the production Bedrock pack, and the 16-chapter Pages
  build.
- Chrome control and Computer Use both failed before connection because their
  configured Node runtime path was unavailable. The required headed Playwright
  fallback opened `manual/#chapter-micropython`. At 1440x900 and 390x844 the
  chapter retained its title/hash, displayed the generator heading,
  `send(value)` text, and first-send restriction, and had no horizontal
  overflow. The only console entry was the local static server's unrelated
  `/favicon.ico` 404; there were no script warnings or exceptions. The browser
  session, generated snapshot/log files, and exact loopback-server processes
  were finalized.
