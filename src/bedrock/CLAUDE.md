# Bedrock adapter guidance

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
  Portable held/placed use, Monitor attachment, reload, disconnect, rollback,
  and dimension changes.
- Desktop and Advanced Desktop Web access requires exactly one physically
  adjacent Monitor. A bare desktop, zero adjacent identities, or multiple
  adjacent identities must fail explicitly. Portable has a built-in display and
  retains its CS386SX/CS-DOS profile through item/block round trips.
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
- BDS transport readiness precedes Script API readiness. Preserve the bounded
  startup grace period. For player UI probes, wait for join completion and retry
  `competing_form` only a bounded number of times.
- Syntax/runtime fault, shutdown, reboot, and display replacement must release
  adapter/broker attachments. Never destructively drain framebuffer tiles per
  player.

## Web handoff and probes

- Enforce the writer/viewer decision returned by the terminal application at the
  Script API bridge. Do not duplicate writer ownership or promote a viewer in
  the adapter; only application-declared final detach may emit
  `terminal_closed`.
- Four-digit connection numbers derive permanently from stable identity and are
  activated for two minutes. Keep lookup O(1), rate-limit invalid guesses per
  client, and fail simultaneous collisions explicitly. Bearer tokens and one-use
  URLs must not enter BDS logs.
- `bds_issue_web_handoff` installs the exact Computer waiter before asking the
  single debug player for its one-use URL. `bds_wait_for_web_handoff` remains
  the passive interaction-first path. Own at most one bounded wait per Computer
  and finalize zero/multiple player, relay, disconnect, cancellation, and
  timeout.
- `bds_execute_computer_command` accepts one exact Computer, a bounded non-TUI
  guest command, and returns bounded stdout/stderr, exit code, and modeled
  cycles. Reject TUI editors, sleep, lifecycle commands, unknown identities,
  commands over 128 characters, and timeouts over 30 seconds. Never broaden it
  into host shell or arbitrary BDS execution.

## Known production constraints

- The native CustomForm width/scroll behavior is a client constraint; do not
  mutate terminal geometry to mask it. The Web Terminal normalizes a writer to
  80x25 once and scales it without changing cell state.
- BDS 1.26 rejects a block declaring both `minecraft:redstone_consumer` and
  `minecraft:redstone_producer`. Computer blocks keep the producer component and
  sample all six adjacent inputs through the bounded redstone poll.
- Minecraft for Windows may reject loopback with `InitialConnection-13`; use the
  host's active LAN IPv4 for testing. Never hard-code a workstation address.
- `WEB_COMPANION_DEBUG_IGNORE_RANGE=1` is managed-debug only. It cannot bypass
  interaction, connection, writer lease, bearer token, session lifetime, or
  disconnect finalization.

## Verification

Run the smallest relevant `npm run test:bds`, `npm run test:bds:disconnect`, or
MCP acceptance, then reproduce visible Resource Pack changes in the real GDK
client. Verify form content and exactly one terminal-close record; a successful
host build is insufficient.
