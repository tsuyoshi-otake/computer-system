# Issue #48: CS Make state consistency v2

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/48

Status: implemented and verified locally on focused host tests, the complete
host gate, isolated MCP/BDS, and real Chrome. The GitHub Issue remains open
until these workspace changes are intentionally committed and published.

## Implemented boundary

- `CSMAKE2` stores bounded SHA-256 input and output fingerprints with an
  explicit CS Make/toolchain/object/executable identity.
- Valid legacy `CSMAKE1`, missing, evicted, pending, and foreign-toolchain
  records are untrusted and rebuild conservatively. Malformed persisted state
  fails explicitly.
- Makefile/state reads, parsing, planning, and fingerprinting occur inside the
  scheduler-admitted make task after its PID and 128 KiB RAM lease exist.
- Every target takes a pre-recipe snapshot, verifies its inputs and output after
  recipe I/O completion, and commits one target record at a time.
- Later target failure retains earlier committed state. State-I/O failure
  restores the last committed serialized state before publishing failure.
- All reads and writes remain canonical credentialed guest filesystem I/O with a
  1 MiB fingerprint content limit and no host execution path.

## Explicit exclusions

GNU/BSD Make compatibility remains outside this Issue. Pattern or implicit
rules, includes, conditionals, recursive make, parallel jobs, pipelines,
redirects, background work, host shells, and CS-DOS MAKE remain unsupported.

## Acceptance

Verify:
`npm exec vitest run tests/runtime/guestMake.test.ts tests/os/makeCommand.test.ts tests/computer/guestResourceAccounting.test.ts tests/computer/linuxMakeProbe.test.ts`.

Expect: Migration, missing/evicted/foreign state, target tamper, mid-build input
change, partial failure, recipe/state I/O failure, DAC denial, admission,
scheduler progress, RAM/PID finalization, and the production probe pass.

Result on 2026-07-20: the final Make/man acceptance run passed 6 files and 27
tests, including direct Makefile, state, input, and output DAC denial.

Verify: `npm run validate`.

Expect: Formatting, lint, TypeScript, all host tests, Bedrock pack build, and
Pages build pass.

Result on 2026-07-20: 180 test files and 1,256 tests passed; the Bedrock pack
and 16-chapter Pages builds completed.

Verify: Run `npm run test:mcp:bds` with isolated BDS workdir, MCP port, and Web
port.

Expect: The real BDS `linux_make/PASS` record includes `stateV2=true`,
`missingStateRecovered=true`, successful build/no-op/rebuild/failure-stop, and
explicit finalization with no diagnostics.

Result on 2026-07-20: PASS with `built=true`, `noOp=true`, `rebuilt=true`,
`failureStopped=true`, `stateV2=true`, `missingStateRecovered=true`,
`finalized=true`, `ticks=80`, zero diagnostics, and final state `idle`.

Verify: Build Pages, open the manual in Chrome, search for `CS Make 1.0`, and
check desktop plus a 390x844 viewport.

Expect: The updated `CSMAKE2`, post-admission planning, and per-target commit
contract is visible with no horizontal overflow or browser errors.

Result on 2026-07-20: Search returned 7 results with CS Make first. The updated
contract was visible. Desktop document/body width was 1263/1263; the 390x844
override produced a 375/375 client/document width with the search and heading
inside the viewport. Chrome reported zero warnings or errors.
