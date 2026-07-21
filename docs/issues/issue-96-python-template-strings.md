# Issue #96: bounded Python 3.14 template strings

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/96>

- Status: implemented; focused, aggregate, full-host, real-browser, and real-BDS
  verified
- Date: 2026-07-21
- Profiles: Computer System Python 1.0 on CS486DX/CS486DX2
- Depends on: #49, #51, #84, #86, #92

## Delivered contract

- `t`/`T` and raw `tr`/`rt` literals share the bounded formatted-string
  replacement parser. They preserve authored expression text, debug equals,
  `s`/`r`/`a` conversion, escaped braces, and eagerly evaluated nested format
  fields while evaluating every replacement exactly once from left to right.
- A template retains each replacement value rather than formatting it. The
  runtime-owned `string.templatelib` intrinsic exposes immutable `Template` and
  `Interpolation` values without host Python, `pip`, or `venv`.
- `Template` exposes read-only `strings`, `interpolations`, and `values`.
  `Interpolation` exposes read-only `value`, `expression`, `conversion`, and
  `format_spec`. Direct constructors and `convert()` use the existing bounded
  Python call and fault paths.
- Iteration emits non-empty literal strings and interpolation objects in source
  order. Template-to-Template concatenation preserves normalized parts; another
  operand is rejected. Interpolation supports the documented four-position class
  pattern.
- One parse admits at most 256 replacements, including nested format fields.
  Runtime strings admit 65,536 code units and template collections admit 4,096
  items. Retained values, metadata, tuples, iteration state, and concatenation
  results remain in the reachable managed heap under the 64-call-depth and outer
  CS486 instruction-slice limits.
- Syntax, expression, constructor, import, capacity, heap, call-depth, and
  scheduler failures use existing rollback and finalization ownership and do not
  publish a partial template.

## Deliberate exclusions

- Custom `__format__` dispatch and the complete Python format mini-language
  remain later work for both formatted and template strings.
- Descriptor/metaclass customization of intrinsic reflection and host CPython
  `string.templatelib` interoperability are not part of the CS Profile.
- `pip`, PyPI, wheels, `venv`, and CPython extension ABIs remain excluded by the
  parent Python profile.

## Acceptance evidence

- Verify:
  `rtk npm test -- tests/language/templateStrings.test.ts tests/runtime/pythonTemplateStrings.test.ts`
  Expect: prefixes, grammar, ordering, nested/debug/raw forms, constructors,
  immutability, iteration, concatenation, matching, limits, heap, and low-slice
  cases pass.
- Verify: `rtk npm run test:python314` Expect: the aggregate Python 3.14 CS
  Profile includes the template-string suite and exits successfully.
- Verify: `rtk npm run test:web`, `rtk npm run test:pages`, and
  `rtk npm run build:pages` Expect: canonical manual assertions, static-page
  tests, and all 16 chapters pass with the template-string contract visible.
- Verify: inspect the generated Python chapter in a real browser at desktop and
  mobile widths. Expect: template-string behavior, limits, and exclusions are
  visible without horizontal overflow or browser errors.
- Verify: `rtk npm run test:mcp:bds` in a dedicated empty BDS runtime. Expect:
  production pack load and the headless guest-process suite finish with zero
  failures/diagnostics and final state `idle`.
- Verify: `rtk npm run validate` Expect: formatting, lint, type checking, all
  tests, hosted-C consistency, the production Bedrock pack, and Pages build
  pass.

## Verification result

- `rtk npm run typecheck` passes against the current implementation.
- The dedicated frontend/runtime pair passes 2 files and 25 tests. The broader
  language/runtime/contract/manual selection passes 32 files and 295 tests.
- The production `python` command integration executes template reflection and
  `string.templatelib` through `ComputerRuntime`, then returns Guest RAM to its
  exact pre-command baseline; its 3-file selection passes 43 tests.
- `rtk npm run test:python314` passes 61 files and 616 tests. Web passes 7 files
  and 101 tests, Pages passes 3 files and 28 tests, and all 16 chapters build.
- Chrome renders the generated Python chapter at 1,248 px and 375 px document
  widths. The template-string section is visible at both sizes, document and
  viewport widths are equal, the mobile section remains within 341 px, and
  browser warnings/errors are zero. The code sample keeps its intentional local
  horizontal scroller. The temporary viewport, tab, and exact local server PID
  were finalized.
- `rtk npm run test:mcp:bds` passes in an empty dedicated runtime on Web port
  4176 and BDS ports 19152/19153. The headless suite reports zero failures, zero
  diagnostics, and final state `idle`; the ports were released and the verified
  temporary runtime was removed.
- `rtk npm run validate` passes formatting, ESLint, TypeScript, all 275 files
  and 2,073 tests, hosted-C consistency, the production Bedrock pack, and the
  16-chapter Pages build.
