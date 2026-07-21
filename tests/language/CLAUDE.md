# Core language test guidance

- These tests cover the Python-like Computer System lexer/parser and authored
  source spans, not shell, assembler, C/C++, or host Python syntax.
- Assert monotonic tokenization, every token/AST form, precise spans,
  first-error termination, malformed/unterminated input, and deterministic
  diagnostics.
- The direct lexer/parser/scope analyzer have explicit instance-scoped ceilings
  and no recovery pass. Every ceiling needs exact-limit, capacity-plus-one, and
  no-partial-AST evidence. Deep syntax and formatted-string cases must terminate
  with a language error rather than a host stack overflow.
- UTF-8 decoding occurs before the lexer. Application module-graph limits are
  verified in Python/runtime suites, not inferred from these unit tests.
- Class tests must distinguish class-local name lookup from method lexical
  lookup, verify enclosing-cell pass-through, and count class scopes against the
  same exact/capacity-plus-one ceilings as functions and comprehensions.
- Decorator tests must cover assignment-expression grammar, adjacency to `def`
  or `class`, containing-scope collection, and exact/capacity-plus-one count
  rejection.
- Generator syntax tests distinguish yield statements from yield expressions,
  cover the sole unparenthesized assignment RHS and parenthesized expression
  positions, verify directly containing scope ownership, accept every
  `try`/`except`/`else`/`finally` suite, cover required-value `yield from`, and
  reject yield in comprehension, class, and module contexts.
- Generator-expression syntax tests cover explicit parentheses, the sole call
  argument form, implicit scope ownership, containing-scope `:=`, nested
  clauses, invalid starred/extra-argument/yield forms, and
  exact/capacity-plus-one limits.
- Context-manager syntax tests cover single/multiple and parenthesized item
  forms, optional/destructuring targets, context-before-target scope collection,
  invalid commas/targets/colons, yield classification, and
  exact/capacity-plus-one item limits.
- Async syntax tests cover decorated `async def`, await precedence, `async for`,
  `async with`, directly containing coroutine ownership, nested sync/class
  boundaries, malformed async targets, and the `yield from` prohibition.
- Exception-group syntax tests cover ordinary versus starred handler AST flags,
  parenthesized and optional-parentheses type lists, bare/mixed-handler
  rejection, malformed comma/`as` forms, and nested-scope boundaries for
  prohibited `return`/`break`/`continue`.
- Template-string tests cover every case-insensitive `t`/`tr` prefix,
  authored/debug metadata, shared formatted-string grammar, raw/triple literals,
  nested format fields, malformed braces/conversions, and exact/plus-one budget.
- Import syntax tests cover dotted clauses, aliases, absolute and
  explicit-relative `from` forms, parenthesized lists and trailing commas,
  module-only wildcard scope, selected-name binding, and malformed relative or
  comma forms.
- Pattern syntax tests keep `match`/`case`/`_` soft, cover every supported
  pattern AST and guard, verify capture/reference scope classification, and
  prove duplicate bindings/keys, unequal OR names, multiple stars,
  irrefutable-case ordering, nesting, and construct capacity failures.
- Annotation syntax tests cover simple/non-simple assignments, every parameter
  kind, returns, annotation-scope restrictions, class namespace lookup,
  function-local non-evaluation, closure classification, and exact scope limits.
- Type-parameter syntax tests cover generic functions/classes/aliases, all three
  parameter kinds, bounds/constraints/defaults, soft-keyword behavior, overlay
  lookup, containing-scope decorators/defaults, later-reference and `nonlocal`
  rejection, and exact construct/scope ceilings.

## Focused verification

Run `npm test -- tests/language` and the Python compiler suites when grammar or
AST shape changes.
