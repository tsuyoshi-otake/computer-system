# Bedrock adapter guidance

## Child scopes

| Child scope                   | Responsibility                                       |
| ----------------------------- | ---------------------------------------------------- |
| [`probes/`](probes/CLAUDE.md) | Bounded real-BDS/GDK probe construction and evidence |

## Adapter boundary

- This is the Minecraft Script API edge. Keep it thin: translate events and UI
  results into application requests, then render application state. Never move
  guest shell, filesystem, account, scheduler, compiler, or persistence policy
  into an event handler.
- Unsupported Script API/GDK behavior fails explicitly. Do not simulate an
  incompatible success or silently switch to a native terminal fallback.
- Bound per-tick block scans, topology work, redraws, queued events, forms,
  retries, persistence steps, terminal deltas, and probe output.

## Computer identity and interaction

- Preserve one Computer identity through block placement/breaking, items,
  Portable held/placed use, integrated-display access, reload, disconnect,
  rollback, and dimension changes.
- Desktop and Advanced Desktop Web access resolves directly from the touched
  all-in-one Computer with its built-in CRT. Do not reintroduce a standalone
  display block or adjacency gate. Portable has a built-in display and retains
  its CS386SX/CS-DOS profile through item/block round trips.
- Placed-machine Web sessions require the player to remain within three blocks
  in the same dimension. Pause as `out_of_range` and resume the same live stream
  on return; do not mint a parallel guest session.
- A normal interaction with a crashed Computer tells the player to sneak for
  one-shot safe boot. Only the sneaking Bedrock action may request it.

## Terminal and lifecycle

- The fixed-cell application terminal is source of truth. Resource Pack forms
  render snapshots and submit bounded semantic input; they do not own history,
  cursor, editor, or process state.
- A form close produces one observable terminal-close request. Cancellation,
  competing form, player disconnect, machine break, server close, and adapter
  failure must all converge on application-owned finalization exactly once.
- Syntax/runtime fault, shutdown, reboot, and display replacement must release
  adapter/broker attachments. Never destructively drain framebuffer tiles per
  player.

## Debug and Web bridge

- Enforce the writer/viewer decision returned by the terminal application at the
  Script API bridge. Do not duplicate writer ownership or promote a viewer in
  the adapter; only application-declared final detach may emit
  `terminal_closed`.
- Validate and correlate bounded Script API debug requests/responses by exact
  Computer identity, and finalize relay success, rejection, disconnect, and
  disposal explicitly. The host MCP API, waiter, command limits, connection-code
  exchange, and rate limiting belong to `tools/`.
- Never place bearer tokens, one-use URLs, or passwords in Script API details or
  BDS logs.

## Managed runtime-worker adapter

- Keep `@minecraft/server-admin` and `@minecraft/server-net` confined to the
  managed-BDS entry and adapter. The ordinary release-pack entry remains
  Beta-free. Managed bootstrap must install the remote process factory before
  the normal Bedrock entry evaluates `computerHost`; invalid or missing worker
  configuration fails startup explicitly.
- Accept only the exact versioned `ws://127.0.0.1:PORT/internal/cs486/v1`
  endpoint, a server-admin bearer secret, and an integer worker count from 1
  through 16. Never accept a LAN/public compute endpoint, place the secret in
  variables or logs, or expose the internal socket through the Web Terminal.
- Adapt the Beta WebSocket client to the application text-socket port without
  adding scheduling or guest-time policy. Preserve correlation and Computer
  identity, use bounded tick timeouts, and settle pending commands on close.
  Once a worker command may have been sent, adapter failure must not replay it
  locally or on another worker.
- The normal Beta-free build may use its declared local execution path because
  no managed factory was installed. A managed connection failure is different:
  surface it explicitly and preserve the affected process's terminal state
  instead of silently switching execution backends.

## Known production constraints

- The native CustomForm width/scroll behavior is a client constraint; do not
  mutate terminal geometry to mask it. The Web Terminal normalizes a writer to
  80x25 once and scales it without changing cell state.
- Sample all six adjacent redstone inputs through the bounded adapter poll. Pack
  component compatibility belongs to `packs/behavior/`.

## Verification

Run the smallest relevant `npm run test:bds`, `npm run test:bds:disconnect`, or
MCP acceptance, then reproduce visible Resource Pack changes in the real GDK
client. Verify form content and exactly one terminal-close record; a successful
host build is insufficient.
