# Issue #45: bounded sed and awk

Status: implemented and host-verified.

## Implemented boundary

- `sed` supports `-n`, `-e`, numeric/last/pattern addresses, and the bounded
  `p`, `d`, and `s` commands.
- `awk` supports `-F`, `BEGIN`/`END`, match/comparison rules, `print`, bounded
  `printf`, `$0` through `$64`, `NR`, and `NF`.
- Both utilities share a guest-owned matcher for literals, dot, star, anchors,
  escaping, and character classes. No user pattern reaches host regular
  expressions or JavaScript evaluation.
- Program, pattern-step, rule, record, field, substitution, input, and output
  work is explicitly bounded. Unsupported language syntax fails visibly.

## Acceptance evidence

- Verify: `npm test -- tests/os/linuxTextProcessors.test.ts` Expect: supported
  transforms, stdin/files, pattern behavior, and explicit unsupported/limit
  failures pass.
- Verify: `npm run validate` Expect: the complete repository validation gate
  passes.
