# Issue #54: bounded arbitrary-precision integers and numeric operators

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/54

Status: Phase 4 implementation and product verification are complete. A later
complete aggregate validation passed after the separately created untracked
`make-snapshot/` tree was no longer present in repository discovery.

Depends on: Epic #49 and Issues #50 through #53.

## Boundary

- Lex decimal, binary, octal, hexadecimal, underscore-grouped, leading-dot,
  trailing-dot, and exponent numeric literals with Python-style rejection of
  leading zeros and misplaced separators.
- Preserve safe integers as compact numbers and promote values outside the host
  safe range to exact arbitrary-precision integers.
- Implement exact integer arithmetic, floor/modulo sign rules, powers, shifts,
  unary invert, and binary bitwise operators with Python precedence.
- Admit at most 262,144 integer magnitude bits by default, with a minimum
  configurable ceiling of 53 bits so every compact safe integer remains valid.
  Check power/shift growth before allocating, then measure reachable integer
  limbs inside the existing managed heap and single physical process grant.
- Convert arbitrary integers to host-backed native guest APIs only when the
  value is exactly representable in their bounded numeric range; otherwise
  report `OverflowError` without host escape.

## Explicit exclusions

Complex/imaginary numbers, `decimal`, `fractions`, operator overloading,
classes, annotations, lambda, comprehensions, generators, async protocols,
`pip`, `venv`, and the final compatibility claim remain outside this phase.

## Acceptance

Verify: `npm run test:python314`.

Expect: literal grammar, precedence, exact large arithmetic, mixed comparisons,
floor/modulo signs, shift/power preflight, exact/capacity-plus-one limits, heap
measurement, and all prior profile regressions pass.

Verify: `npm run validate`.

Expect: the complete host gate passes once local snapshot copies are outside
repository discovery; otherwise every product gate passes independently and the
snapshot-only residual remains explicit.

## Local verification result

- `npm run test:python314`: 15 files and 125 tests passed.
- Repository-source formatting, ESLint, and TypeScript passed.
- All 189 product test files outside the snapshot-sensitive guidance scanner
  passed with 1,333 tests.
- The production Bedrock pack and 16-chapter Pages builds passed.
- A later literal `npm run validate` passed with 192 test files and 1,349 tests,
  the production Bedrock pack, and the 16-chapter Pages build. No numeric gate
  residual remains.
