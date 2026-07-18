# Tooling and companion guidance

## Host/guest boundary

Tools may build, deploy, start, probe, or relay to BDS, but they never turn
guest input into arbitrary host or BDS administration execution. Validate and
bound all CLI, environment, network, JSON, path, process, and relay inputs
before effects.

- The Resource Pack cannot run MCP. `bds-mcp-server.mjs` is the local stdio
  companion registered as `computer_system_bds` by `.codex/config.toml`.
- MCP Computer commands stay inside `ShellSession`. Keep the allowlist, exact
  Computer targeting, non-TUI restriction, 128-character command limit, bounded
  output, and 30-second timeout ceiling.
- Web lifecycle relays allowlist and scope `safe_boot` to the exact Computer.
  They do not expose it as an MCP or guest-shell command and do not decide
  crashed-state eligibility.
- Keep passwords, bearer tokens, one-use URLs, connection-code exchanges, and
  private origins out of repository files and logs. Mask secrets in errors.
- `BDS_HOME` is a read-only distribution source. Never modify or recursively
  delete it. The default managed workdir is
  `%USERPROFILE%\tmp\computer-system-bds\mcp-runtime`; a custom
  `BDS_MCP_WORKDIR` must be dedicated and must not be reset when non-empty.

## Managed BDS and MCP procedure

- Preserve the interactive managed world for ordinary work. Use
  `resetWorld: false`; reset only for an explicitly requested clean-world
  acceptance.
- Transport readiness precedes Script API initialization. Keep the bounded
  startup grace period, verify player count/readiness, and wait for join
  completion before UI probes. Retry `competing_form` only a bounded number of
  times.
- Resolve the managed world's current exact `c-xxxxxx` identities and persisted
  hardware profiles. Never reuse an old four-digit browser number, LAN address,
  player name, or stale Computer ID as MCP identity.
- Activate and verify the Web Terminal entirely through MCP. Do not use Computer
  Use, Minecraft UI automation, right-click simulation, a connected Bedrock
  player, or manual player interaction for this debug workflow. Start with
  `bds_start({ resetWorld: false })`, page current placed identities with
  `bds_list_computers`, select the exact Computer ID, then call
  `bds_open_web_terminal`. That MCP tool activates the Computer through a
  headless debug principal, opens the one-use handoff in the companion host's
  default browser, and succeeds only after that exact session becomes the
  writer. Bedrock accepts this principal only from a `ScriptEventSource.Server`
  event; Entity, Block, and NPC sources fail explicitly. Normal player-owned
  sessions retain their proximity and disconnect rules. Use
  `bds_get_tui_screen`, `bds_verify_tui_screen`, `bds_send_tui_input`, and
  `bds_wait_for_tui_screen` on the registered exact debug writer. Use the
  verifier for bounded pass/fail evidence over geometry, cursor, color grids,
  literal presence/absence/order, same-row groups, and continuous vertical
  character runs without returning the screen text; use capture only when the
  actual cells are needed. Drive a bounded non-secret line/key/interrupt
  sequence and wait event-first for the expected literal screen. Never accept a
  Player-owned session, follow a writer replacement implicitly, poll logs for
  frames, or admit MCP input while the current runtime prompt is secret. The
  versioned screen result uses `surface.kind: "text"`; future graphics use a
  distinct bounded pixel/tile surface without turning text and VRAM into
  parallel truth. Use `bds_status`, `bds_get_logs`, and `bds_wait_for_log` for
  supporting evidence; do not hand the URL to a separate browser automation
  tool.
- `bds_open_web_terminal`, `bds_issue_web_handoff`, and
  `bds_wait_for_web_handoff` own at most one bounded wait per exact Computer.
  Install the waiter before issuing the one-use path and finalize every source
  rejection, relay, disconnect, cancellation, and timeout path.

## Guest benchmark and load evidence

Use MCP guest execution; never substitute host Python, compilers, shells, or
timers.

1. Start/status BDS with the intended reset policy, then confirm Script API and
   player readiness through bounded commands/logs.
2. Resolve exact identities and profiles from the current world.
3. Create sources inside the Computer sandbox. Each ordinary debug request is
   one non-TUI line of at most 128 characters; use bounded `echo`/redirection
   calls. If DOS quoting cannot represent a line, use the live editor rather
   than widening MCP. Only bounded Python `-c` may contain encoded newlines.
4. Compile in the guest with `as`, `cc`, or `c++`, then use `run --stats`.
   Current CS-Linux has no BASIC command. CS QBASIC is DOS-only and currently
   runs through its interactive IDE or `/RUN`; do not report QBASIC benchmark
   statistics until an explicit non-TUI statistics path exists. Use `python`,
   `micropython`, or `python -c` only on supported CS486 profiles; CS386SX
   status 127 is expected.
5. Hold algorithm, input, checksum, compiler mode, and cold start constant.
   Record stdout, stderr, exit code, and modeled cycles. Label wall-clock MCP
   latency as responsiveness, not language speed.
6. Prove correctness sequentially before bounded concurrency. Stay below the MCP
   pending-command limit and record BDS tick p50/p95/p99/max plus MCP latency.
   Timeout, 124, yielded/incomplete work, or quiet logs are not capacity proof.
7. After every stage, inspect new logs for watchdog, crash, fatal, Script API,
   queue, and slow-tick evidence; verify Minecraft/Web responsiveness. Exercise
   capacity-plus-one and require bounded rejection while admitted work
   continues.

Minimal compiled execution uses exact identity:

```json
{
  "computerId": "c-xxxxxx",
  "command": "run --stats /tmp/bench",
  "timeoutMs": 30000
}
```

On DOS use a valid 8.3 path. Until Issue #16 is complete, never infer multi-user
capacity from sequential MCP results.

`npm run test:mcp:serial:bds` requires a fresh isolated `BDS_MCP_WORKDIR` and
free BDS/Web ports. It must produce `serial_matrix/PASS` for three machines, six
faces, 36 ordered links, and 72 bidirectional ttyS/COM transmissions, then stop
the isolated server. Never point it at the interactive world.

## Web companion networking

- Companion entry points listen on `0.0.0.0:80` by default and select a
  non-virtual LAN IPv4. `WEB_COMPANION_HOST` controls listening;
  `WEB_COMPANION_PUBLIC_HOST` overrides detected advertisement.
- For Internet access, listen on loopback, set an HTTPS
  `WEB_COMPANION_PUBLIC_ORIGIN`, and use a TLS reverse proxy. Never expose plain
  HTTP to the Internet.
- Persist listener port and complete origin with
  `npm run web:config -- set --port PORT --url ORIGIN`. Both entry points read
  the versioned system JSON; environment variables are explicit per-process
  overrides. Reject unknown fields/invalid origins and require restart after
  change.
- With `WEB_COMPANION_AUTO_OPEN` unset, auto-open only when the literal
  published IP belongs to the companion host and the activated URL is reachable
  through loopback. `0` disables; `1` enables subject to reachability. A custom
  public origin never enables automatic mode. This opens the server host's
  browser, not a remote player's; remote players use the LAN page and four-digit
  number.
- Derive each stable four-digit Computer number from identity, activate it for
  two minutes, keep lookup O(1), rate-limit guesses per client, and fail active
  collisions explicitly. Tokens and one-use paths never enter BDS logs.
- `WEB_COMPANION_DEBUG_IGNORE_RANGE=1` is managed-debug only. It cannot bypass
  initial interaction, connection, writer lease, bearer token, session lifetime,
  or disconnect finalization.
- Minecraft for Windows may reject loopback with `InitialConnection-13`; test
  through the host's active LAN IPv4 and never hard-code a workstation address.
- Deduplicate reconnect work, honor rate-limit windows and `Retry-After`, use
  exponential backoff with jitter, and cap attempts/session lifetime. Diagnose
  429s by proving whether startup, refresh, retry, or multiple tabs generate
  hidden repeated work before changing limits.

## Pages and asset builders

- `build-pages.mjs` consumes only canonical `web/manual.js` plus explicit
  templates/assets. Publish the exact static allowlist to `dist/pages`; never
  include live `web/index.html`, `web/app.js`, tokens, API calls, or session
  code.
- Treat scoped `CLAUDE.md` files under authored asset directories as private
  repository metadata: skip them explicitly and prove they never enter the Pages
  artifact. Continue rejecting every other unsupported asset.
- Support arbitrary base URLs, deterministic 404 recovery, no-JS manual content,
  `.nojekyll`, robots, and sitemap. Reject hidden/unsupported/symlink assets and
  unexpected outputs. Recursive cleanup is allowed only under repository
  `dist/`.
- Machine plates are authored under `web/assets/machines/`; CPU plates under
  `web/assets/cpu/`. `machine-textures.mjs` derives bounded transparent 256 px
  item icons. `machine-block-assets.mjs` derives purpose-built geometry, terrain
  atlas entries, and 16 px faces. Never use isometric plates as block-face UVs.
- Reject unsupported source PNGs explicitly and keep generated file sets
  deterministic. Shipped artwork changes require the Resource Pack version bump
  defined by `packs/CLAUDE.md`.

## Verification

Use focused `tests/tools/` suites while iterating, then `npm run validate`.
Companion changes need MCP/real-BDS evidence; Web changes need a real browser;
asset changes need a production pack build and real GDK visual verification.
