# Core language guidance

## Source and diagnostics

- Source locations and spans remain attached through lexing and parsing.
  Diagnostics identify the authored range; `VmRuntimeError` spans are optional,
  so do not claim every runtime failure carries one.
- Tokenization is deterministic and locale-independent, but the direct lexer and
  parser currently impose no token, identifier, literal, or nesting budgets.
  Bounded application callers own source/module limits; do not claim the
  primitive parser enforces ceilings it does not implement.
- User text must not create an unbounded regular-expression path.

## Lexer, parser, and AST

- The lexer consumes source monotonically and reports malformed/unterminated
  tokens explicitly. It receives a JavaScript string; any UTF-8 decoding and
  byte validation must happen before lexing.
- This AST/parser is the Python-like Computer System language grammar. Keep it
  independent of shell syntax, CS486 assembler syntax, and Minecraft adapters.
- Parsing throws on the first syntax error; there is no recovery pass. Nested
  syntax and f-string recursion remain an uncapped hardening gap. Preserve
  monotonic input progress and add explicit limits before describing them as
  bounded.
- A parse failure emits no executable program and leaves no partially registered
  definitions.
- Current application graph limits are 512,000 total UTF-8 source bytes, 64
  modules, and import depth 16; those limits do not make direct lexer/parser
  recursion bounded.

## Verification

Use `tests/language/lexer.test.ts` and `tests/language/parser.test.ts`. Cover
every token/AST form, precise spans, malformed and truncated input, first-error
termination, deterministic diagnostics, current caller graph limits, and deep
nesting/f-string hardening cases when adding parser ceilings.
