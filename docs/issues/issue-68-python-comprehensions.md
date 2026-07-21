# Issue #68: Python sets and comprehensions

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/68

Status: Phase 11 implementation and complete local aggregate verification are
complete. The synchronized manual text awaits the final real-browser publication
pass.

Depends on: Epic #49, Issues #50 through #57, Issue #59, Issue #66, and Issue
#67.

## Boundary

- Parse eager list, set, and dictionary comprehensions with bounded synchronous
  `for`/`if` clauses and identifier or nested list/tuple targets.
- Evaluate the leftmost iterable once in the enclosing scope, then run targets,
  later iterables, filters, and results in a non-leaking implicit function
  scope.
- Preserve left-to-right clause nesting and dictionary key-before-value order.
- Bind contained assignment expressions in the containing non-comprehension
  scope; reject iterable assignment expressions and conflicts with any enclosing
  iteration target.
- Add explicit/starred set displays, `set()` with zero or one iterable,
  deterministic iteration, membership, `len`, equality, and canonical bounded
  primitive/tuple hashing. Reject mutable set elements.
- Reuse the direct CS486 function/call path, scope/call/stack/collection limits,
  and reachable managed-heap accounting. Unique growth and hash construction
  preflight their collection and string ceilings.

The canonical set index makes unique insertion and membership average O(1);
comprehension traversal remains O(P), where P is the number of produced
clause-path visits. Dictionary and set duplicate entries do not consume another
collection slot.

## Explicit exclusions

Generator expressions, `yield`, asynchronous comprehensions, `async for`,
`await`, class-scope comprehension behavior, custom `__iter__`/`__hash__`/
`__eq__`, set subclasses, the remaining set algebra/method API, `pip`, `venv`,
and the final Python 3.14 compatibility claim remain outside this phase.

## Acceptance

Verify: `npm run test:python314`.

Expect: syntax/AST, explicit and starred sets, all eager comprehension kinds,
destructuring targets, implicit scopes, leftmost/later evaluation order,
dictionary key-before-value order, assignment-expression rules, nested
comprehensions, exact/capacity-plus-one limits, hashability, and all earlier
profile regressions pass.

Verify: `npm run validate`.

Expect: formatting, ESLint, TypeScript, every host test, the production Bedrock
pack, and the 16-chapter Pages build pass.

Official references:

- <https://docs.python.org/3.14/reference/expressions.html#displays-for-lists-sets-and-dictionaries>
- <https://docs.python.org/3.14/reference/expressions.html#set-displays>
- <https://docs.python.org/3.14/reference/expressions.html#dictionary-displays>
- <https://peps.python.org/pep-0572/#scope-of-the-target>

## Local verification result

- Focused syntax/runtime/heap/contract verification: 4 files and 40 tests
  passed.
- `npm run test:python314`: 29 files and 261 tests passed.
- Focused ESLint, TypeScript, and `git diff --check` passed.
- `npm run validate` passed: repository-wide formatting, ESLint, TypeScript, all
  211 test files and 1,508 tests, the production Bedrock pack, and the
  16-chapter Pages build completed.
- The canonical manual and generated Pages describe sets and comprehensions, but
  this phase does not claim a post-change real-browser check or publication.
  That evidence remains part of the final profile/manual gate.
