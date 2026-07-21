# Issue #50: Python 3.14 compatibility contract and conformance harness

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/50

Status: implemented and verified locally through the focused Python contract and
runtime suite, Pages tests, TypeScript, and the complete host gate. The GitHub
Issue remains open until these workspace changes are intentionally committed and
published. This Issue does not claim final Python 3.14 compatibility.

Depends on: Issue #49.

## Implemented boundary

- Define the versioned `python-3.14-cs` profile in a machine-readable manifest.
- Separate current `partial` behavior from `planned` end-state behavior.
- Freeze the direct CS486 execution model, hardware gate, import roots, native
  extension policy, deliberate exclusions, and final claim gates.
- Add a focused test command that checks contract/documentation agreement and
  runs the current Python compiler/runtime regression suites.
- Replace ambiguous “MicroPython-compatible” and “Python virtual machine”
  product claims while retaining `micropython` as a compatibility alias.

## Explicit exclusions

This Phase does not add grammar, runtime, built-in, standard-library, async, or
package features. It creates the enforceable baseline those later phases must
update with verified evidence.

## Acceptance

Verify: `npm run test:python314`.

Expect: the manifest has a unique complete feature inventory, keeps the claim at
`targeting`, includes `pip` and `venv` among deliberate exclusions, preserves
the CS486/CS386SX hardware contract, and agrees with maintainer and user docs;
all selected current runtime tests pass.

Result on 2026-07-20: 5 files and 38 tests passed.

Verify: `npm run validate`.

Expect: formatting, lint, TypeScript, all host tests, the production Bedrock
pack build, and the Pages build pass without weakening existing behavior.

Result on 2026-07-20: 181 test files and 1,261 tests passed; the production
Bedrock pack and 16-chapter Pages builds completed.
