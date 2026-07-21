# Issue #60: Bounded CS-Linux Git-like version control

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/60

Status: Local implementation and focused host verification are in progress.

Related: Issues #6, #12, #17, #31, and #38.

## Boundary

- Install Linux-only `/usr/bin/git` in immutable rootfs v12 while preserving v11
  and all older images unchanged.
- Implement independently encoded `.git` repositories with a required unknown
  native-Git extension, SHA-256 blob/tree/commit objects, a checksummed index,
  branches, tags, compare-and-swap refs, and strict corruption handling.
- Support bounded local `init`, `status`, `add`, `rm`, `commit`, `log`, `show`,
  `diff`, `branch`, `switch`, `checkout`, `merge`, `tag`, `remote`, and local
  identity `config` commands.
- Support `.gitignore`, `.git/info/exclude`, `git add -f`, binary contents,
  executable mode, and symbolic-link targets without following links.
- Account all payload I/O through the guest filesystem/block owner, acquire one
  1 MiB Linux transient reservation with sequential bounded buffers, and
  finalize it on every terminal path.
- Preserve a future authenticated remote boundary with bounded phase work,
  cancellation, quarantine verification, ref CAS, and an explicit unknown result
  when an update acknowledgement may have been lost.

## Explicit exclusions

Native Git repository/protocol interoperability, host Git, host sockets, hooks,
credential helpers, filters, submodules, worktrees, alternates, LFS, signing,
shallow history, config includes, path environment overrides, pack compression,
garbage collection, rebase, cherry-pick, stash, and actual clone/fetch/pull/push
transport remain outside 1.0. Remote metadata is inert; all network operations
fail explicitly until the guest TCP/IP and authentication implementation exists.

## Acceptance

Verify:
`rtk vitest run tests/os/gitRepository.test.ts tests/os/gitIgnore.test.ts tests/os/gitSecurity.test.ts tests/os/gitCommand.test.ts`.

Expect: local workflows, ignore semantics and precedence, binary/mode/symlink
tracking, exact capacity and capacity-plus-one rollback, corrupt object/index
and ownership rejection, Linux/DOS exposure, RAM finalization, and block-I/O
accounting pass.

Verify:
`rtk vitest run tests/application/gitRemoteArchitecture.test.ts tests/architecture/dependencyBoundaries.test.ts tests/architecture/osShellBoundaries.test.ts tests/computer/linuxGitProbe.test.ts tests/bedrock/headlessAuthenticationProbe.test.mjs`.

Expect: the transport and credential ports remain inward-facing and bounded;
production ComputerRuntime
init/commit/ignore/switch/merge/remote-failure/shutdown publishes the stable
`linux_git/PASS` contract; static Bedrock probe wiring and host smoke validation
both require that record.

Verify:
`rtk vitest run tests/os/osStorageImage.test.ts tests/os/osCommandBoundary.test.ts tests/os/linuxManual.test.ts`.

Expect: v12 installs Linux Git, v11 remains immutable without it, CS-DOS and its
completion stay unchanged, and the installed `man git` page states
compatibility, resource, security, filesystem-metadata, and remote limitations
exactly.

Verify: `rtk npm run test:mcp:bds`.

Expect: real BDS completes the production headless suite and emits one bounded
`linux_git/PASS` record with initialized, committed, ignored, switched, merged,
remoteUnavailable, and finalized all true.

Verify: `rtk npm run validate`.

Expect: formatting, ESLint, TypeScript, all Vitest tests, the production Bedrock
pack, and the 16-chapter Pages build pass.

## Local verification result

- Focused repository, ignore, security, shell, OS boundary, ComputerRuntime, and
  probe-contract tests pass; aggregate and real-BDS results will be recorded
  after the final validation pass.
