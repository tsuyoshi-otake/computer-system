# CLAUDE.md

## Project overview

Computer System is a ComputerCraft-inspired Minecraft Bedrock Add-On. User
programs run in a deterministic, sandboxed, MicroPython-compatible VM called
Computer System Python. Minecraft-specific behavior is implemented by thin
Bedrock adapters around host-testable domain and application layers.

The active tracking item is GitHub Issue #4, the Phase 2 Bedrock Computer
vertical slice. Most Phase 2 behavior is implemented and verified. The native
GDK terminal is a bounded fallback; the preferred interactive terminal is the
local Web Terminal companion started with `npm run dev:bds:web`.

## Architecture rules

Keep dependencies directed inward:

```text
Bedrock adapters -> application services -> domain/runtime abstractions
```

- Do not import Minecraft APIs into the domain or application core.
- Keep terminal state in the fixed-cell terminal model; Resource Pack UI is a
  rendering and input adapter, not the source of truth.
- Keep shell commands inside `InMemoryFilesystem` and application-layer
  abstractions. Never dispatch terminal input to host PowerShell, `cmd.exe`,
  Node child processes, or BDS administration commands.
- Bound scheduler work, redraws, queues, retries, polling, and startup waits.
- Every stateful branch must reach an explicit observable terminal state.
  Cancel, disconnect, competing form, server close, failure, and retry paths
  must each have one finalization owner.
- Preserve computer identity and storage transactionally across block, item,
  pocket, monitor, reload, and rollback paths.
- Unsupported Bedrock behavior must fail explicitly rather than silently
  approximating incompatible behavior.

## Required verification

Use Node.js 24 or later. Before handing off a non-trivial change, run:

```powershell
npm run validate
```

Relevant focused commands are:

```powershell
npm run test:mcp
npm run test:mcp:bds
npm run test:bds
npm run test:bds:disconnect
```

`npm run validate` is the standard host gate: formatting, lint, TypeScript type
checking, tests, and the production pack build must all pass. Bedrock-facing
changes also require the smallest applicable real-BDS or GDK verification.

For each non-trivial acceptance criterion, record an executable `Verify:` step
and an observable `Expect:` result. Do not treat a successful build as proof of
Minecraft UI behavior.

## BDS and MCP workflow

The Resource Pack cannot run MCP. Use the local stdio companion in
`tools/bds-mcp-server.mjs`, registered as `computer_system_bds` by
`.codex/config.toml`.

The companion exposes status, start, stop, logs, bounded log waits, allowlisted
commands, and Computer System probes. Preserve the managed debug world for
interactive development and reset it only for clean-world acceptance.

`BDS_HOME` is a read-only distribution source. Never modify or recursively
delete it. The default managed work directory is
`%USERPROFILE%\tmp\computer-system-bds\mcp-runtime`. A custom `BDS_MCP_WORKDIR`
must be a dedicated directory; tooling must not reset a non-empty custom
directory.

BDS reports transport readiness before Script API initialization is complete.
Keep the bounded startup grace period. For player UI probes, wait until the
player has finished joining before opening a form, and retry a bounded number of
times when the result is `competing_form`.

Minecraft for Windows may reject loopback with `InitialConnection-13`. When that
happens, connect to the BDS port through the machine's active LAN IPv4 address.
Do not hard-code a workstation-specific address in repository files.

## Current terminal UI findings

The July 2026 live GDK verification established the following:

- Minecraft connected to the persistent managed BDS runtime on port 19142.
- The MCP `ui` probe reached the player and opened the production Resource Pack
  terminal.
- The form displayed the terminal title, ready text, cursor, and all 16 color
  samples.
- Closing the form produced exactly one `CS_TERMINAL_CLOSE` record with
  `kind: "cancelled"`.
- At a 2560-pixel-wide desktop, the native form remained roughly 700 logical
  pixels wide, and scrolling could leave a large blank content region. This is a
  client CustomForm constraint rather than a terminal-model constraint.
- The Web Terminal renders the same terminal snapshot in a full-width browser
  screen. Its semantic input is visually overlaid at the terminal cursor, so
  physical typing appears immediately after the shell prompt instead of in a
  separate text box.
- Physical Enter submits `terminal_line`; Ctrl+C invokes the bounded interrupt
  endpoint; Up and Down navigate local command history.
- Browser handoff links are one-use and valid for 60 seconds. Browser bearer
  tokens do not pass through BDS logs. Sessions, listeners, polling retries, and
  Bedrock snapshot work are all bounded and end in an explicit final state.

Reproduce native Resource Pack UI changes on the real GDK client. For Web
Terminal changes, run the focused Web tests and verify the connected state,
inline typing, physical Enter, and disconnect behavior in a real browser.

## Web companion networking

The default Web companion is loopback-only on TCP 19144. `WEB_COMPANION_HOST`
controls the listening interface, while `WEB_COMPANION_PUBLIC_HOST` controls the
host printed in LAN handoff links. For Internet access, keep the process on
loopback, set `WEB_COMPANION_PUBLIC_ORIGIN` to an HTTPS origin, and use a TLS
reverse proxy. Never publish the plain HTTP port directly to the Internet.

## Shell compatibility

The OS 0.2 shell is a bounded BusyBox-compatible subset implemented by
`shellSyntax.ts`, `shellCommands.ts`, and `shellSession.ts`. It supports
quoting, variables, `$?`, `|`, `<`, `>`, `>>`, `&&`, `||`, `;`, and bounded
`sh`/`bash` scripts. Pipeline data stays in memory and is capped; script depth
and line counts are capped; regex-like user input must not introduce an
unbounded regular expression execution path. Add applets to the sandboxed
command runtime rather than invoking host tools.

## Development conventions

- Keep source, tests, documentation, and Issue evidence synchronized.
- Do not commit generated `dist/` output unless a release workflow explicitly
  requires it.
- Preserve unrelated working-tree changes.
- Use English commit messages with a useful description and reference Issue #4
  while Phase 2 work remains in scope.
- Keep temporary scripts and work artifacts under `%USERPROFILE%\tmp`, not the
  user home directory root.

Further details are in `README.md`, `docs/development.md`,
`docs/mcp-debugging.md`, and `docs/manual-verification.md`.
