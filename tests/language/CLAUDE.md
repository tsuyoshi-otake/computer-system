# Core language test guidance

- These tests cover the Python-like Computer System lexer/parser and authored
  source spans, not shell, assembler, C/C++, or host Python syntax.
- Assert monotonic tokenization, every token/AST form, precise spans,
  first-error termination, malformed/unterminated input, and deterministic
  diagnostics.
- The direct lexer/parser currently have no token/identifier/literal/nesting
  ceilings or recovery pass. Do not write tests that imply those exist. Add deep
  syntax/f-string regression cases when implementing explicit limits.
- UTF-8 decoding occurs before the lexer. Application module-graph limits are
  verified in Python/runtime suites, not inferred from these unit tests.

## Focused verification

Run `npm test -- tests/language` and the Python compiler suites when grammar or
AST shape changes.
