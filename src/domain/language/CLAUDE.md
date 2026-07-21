# Core language guidance

## Source and diagnostics

- Source locations and spans remain attached through lexing and parsing.
  Diagnostics identify the authored range; `VmRuntimeError` spans are optional,
  so do not claim every runtime failure carries one.
- Tokenization is deterministic and locale-independent. The direct lexer,
  parser, and scope analyzer enforce instance-scoped source, token, identifier,
  literal, construct, symbol, and nesting ceilings before mutation. Keep each
  exact-limit and capacity-plus-one case synchronized with the compatibility
  manifest.
- User text must not create an unbounded regular-expression path.

## Lexer, parser, and AST

- The lexer consumes source monotonically and reports malformed/unterminated
  tokens explicitly. It receives a JavaScript string; any UTF-8 decoding and
  byte validation must happen before lexing.
- This AST/parser is the Python-like Computer System language grammar. Keep it
  independent of shell syntax, CS486 assembler syntax, and Minecraft adapters.
- Parsing throws on the first syntax error; there is no recovery pass. Nested
  syntax, unary/power recursion, suites, and formatted-string embedded parsers
  share explicit budgets and must terminate with `LanguageSyntaxError` before a
  host stack overflow.
- A parse failure emits no executable program and leaves no partially registered
  definitions.
- `lambda` creates a real function scope under the same scope-count, nesting,
  symbol, parameter, closure, and source-span rules as `def`; it is not an
  inline host callback.
- Ordinary assignment collects the RHS before left-to-right targets. Augmented
  identifier assignment is both a reference and an assignment for whole-function
  scope analysis; target-side expressions are collected once.
- Starred displays and nested assignment targets share construct, scope, and
  expression limits. Reject a second starred target at the same nesting level
  before emitting any executable program.
- A slice is one object plus optional start, stop, and step expressions.
  Preserve source order, reject extra separators or augmented slice assignment
  during parsing, and route every present component through ordinary scope
  analysis.
- Assignment expressions accept only an identifier target. Preserve Python's
  parenthesis-sensitive placements, collect the RHS before the target
  assignment, and classify that target through whole-function lexical binding.
- `assert` parses one expression plus an optional comma-separated message. Keep
  both in scope analysis even though runtime evaluation of the message is lazy.
- List/set/dictionary comprehensions create one implicit function scope. Collect
  the leftmost iterable in the enclosing scope, reject assignment expressions in
  every iterable, keep targets from leaking, and reject a `:=` target that
  conflicts with any enclosing comprehension iteration target.
- Synchronous generator expressions use that same implicit scope. Parenthesized
  forms and a sole unparenthesized call argument are valid; starred results and
  extra arguments are not. The leftmost iterable remains in the enclosing scope,
  and yield/yield-from remain forbidden inside the implicit generator scope.
- A class definition creates a bounded class scope after collecting its base
  expressions in the enclosing scope. Class locals are not closure owners for
  methods; forward enclosing function cells through the class scope, including a
  same-name class local that reads the enclosing cell before assignment.
  Functions and lambdas that reference `__class__` or unshadowed builtin `super`
  additionally request one hidden class cell without consuming an authored
  symbol slot or changing class-body name binding.
- Decorator lines are one bounded construct attached only to the following
  function or class definition. Collect decorator expressions in the containing
  scope before defaults or bases; they never belong to the new function/class
  scope.
- A `yield` statement or expression carries zero or one value. An
  unparenthesized yield expression is accepted only as the sole assignment RHS;
  other expression positions require parentheses. Generator ownership belongs to
  the directly containing `def` or `lambda`; nested function/class suites do not
  classify the outer scope. Yield remains valid throughout
  `try`/`except`/`else`/`finally`. `yield from` requires one expression and has
  the same directly containing generator owner. Reject yield inside a
  comprehension's implicit scope and every other invalid yield context
  explicitly.
- A synchronous `with` statement owns one bounded item list. Collect each
  context expression before its optional assignment target, then collect the
  suite. Parenthesized items may use a trailing comma; the unparenthesized form
  may not. A yield in a context expression or suite still classifies the
  directly containing function as a generator.
- `async def` creates a coroutine scope even when its body contains no `await`.
  Permit `await`, `async for`, and `async with` only in that directly containing
  coroutine scope; nested synchronous function and class scopes form explicit
  boundaries. Reject `yield from` in a coroutine, and keep async statement item
  and target collection under the same construct/scope ceilings as synchronous
  forms.
- An `except*` handler requires a type expression, may use the bounded
  optional-parentheses comma list, and may not coexist with ordinary `except` in
  one `try`. Reject `return`, `break`, and `continue` recursively within its
  suite while treating nested function and class scopes as explicit boundaries.
- Template and formatted strings share one bounded replacement parser. Preserve
  authored expression/debug/conversion/format metadata, recurse through nested
  format fields under the same budget, and distinguish raw `tr`/`rt` literal
  text without introducing a second expression parser.
- Import syntax distinguishes dotted `import` binding from absolute or
  explicit-relative `from` binding. Parenthesized selected-name lists may have a
  trailing comma; an unparenthesized list may not. Wildcard imports are valid
  only at module scope, and selected aliases are ordinary scope assignments.
- `match`, `case`, and `_` remain soft keywords. Detect a match statement only
  from statement context, parse case suites under the shared block/expression
  budgets, and reject duplicate captures, unequal OR bindings, duplicate/static
  mapping keys, multiple stars, and unreachable irrefutable cases before code
  generation. Pattern value/class references are scope references; captures are
  ordinary assignments in the containing scope.
- Current application graph limits are 512,000 total UTF-8 source bytes, 64
  modules, and import depth 16. They remain independent from the direct frontend
  ceilings recorded in `docs/python-314-compatibility.json`.
- Python 3.14 annotations use distinct bounded annotation scopes. Simple module
  and class targets contribute deferred entries; function-local annotations only
  classify the local name. Function parameter/return annotation scopes may
  capture enclosing function cells and may read the immediately enclosing class
  namespace. Reject `yield`, `yield from`, and `:=` in the annotation scope
  itself, while preserving nested function scopes.
- Generic `def`, `class`, and soft-keyword `type` statements share a bounded
  annotation-scope overlay. Type parameters are authored-order cells available
  to annotations, class bodies/bases, and lazy alias expressions but never to
  decorators or function defaults. Reject duplicate, misordered, later-
  referencing, forbidden-expression, and `nonlocal` forms before code
  generation; count type scopes and parameter lists against the shared limits.

## Verification

Use the lexer, parser, limits, and scope tests under `tests/language/`. Cover
every token/AST form, precise spans, malformed and truncated input, first-error
termination, deterministic diagnostics, current caller graph limits, and deep
nesting/f-string hardening cases when adding parser ceilings.
