# Bedrock MCP debugging

The resource pack is static client content, so it cannot host a process or an
MCP transport itself. This repository includes a local stdio MCP companion that
builds the current Behavior and Resource Packs, runs an isolated Bedrock
Dedicated Server, sends allowlisted commands through server stdin, and exposes
bounded logs to Codex.

The MCP server treats `BDS_HOME` as a read-only distribution source. Its default
managed runtime is `%USERPROFILE%\tmp\computer-system-bds\mcp-runtime`; it never
recursively deletes `BDS_HOME`. Set `BDS_MCP_WORKDIR` only to a dedicated empty
directory. A non-empty custom directory is never reset automatically.

## Codex setup

The project-scoped [`.codex/config.toml`](../.codex/config.toml) registers the
`computer_system_bds` stdio server. Trust this repository and restart Codex (or
start a new Codex session) after pulling or changing the configuration.

The server uses these optional environment variables:

| Variable                      | Default                                             | Purpose                                                        |
| ----------------------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| `BDS_HOME`                    | `%USERPROFILE%\tmp\computer-system-bds\runtime`     | Extracted official BDS distribution used only as a copy source |
| `BDS_MCP_WORKDIR`             | `%USERPROFILE%\tmp\computer-system-bds\mcp-runtime` | Isolated MCP debug runtime                                     |
| `BDS_MCP_PORT`                | `19142`                                             | IPv4 server port; IPv6 uses the following port                 |
| `BDS_MCP_WORLD`               | `ComputerSystemMcpDebug`                            | Debug world name                                               |
| `WEB_COMPANION_HOST`          | `127.0.0.1`                                         | Web listener interface                                         |
| `WEB_COMPANION_PORT`          | `19144`                                             | Web listener TCP port                                          |
| `WEB_COMPANION_PUBLIC_HOST`   | Listener host                                       | Reachable host used in generated HTTP links                    |
| `WEB_COMPANION_PUBLIC_ORIGIN` | unset                                               | Complete HTTPS origin advertised behind a reverse proxy        |
| `WEB_COMPANION_AUTO_OPEN`     | `0`                                                 | Open each loopback handoff once in the host's default browser  |

No API key or `.env` file is required.

## MCP workflow

1. Call `bds_status`.
2. Call `bds_start` with `resetWorld: true` for a clean world, or `false` to
   preserve the managed debug world.
3. Connect Minecraft to `127.0.0.1` at the reported port. The server requires
   the current Resource Pack and grants operator permissions.
4. Call `bds_run_probe` with `probe: "ui"` and `target: "all_players"`. The
   server executes the script event as each connected player, which preserves
   the player source required by the UI probe.
5. Use `bds_wait_for_log` and `bds_get_logs` to inspect `CS_PROBE_RESULT`,
   `CS_TERMINAL_CLOSE`, Script API, JSON, and UI diagnostics.
6. Call `bds_stop` and verify that the returned state is `idle`.

`bds_run_command` is intentionally restricted to `list`, the server-side
`headless` probe, and player-scoped Computer System probes. It rejects arbitrary
administration commands, command separators, newlines, and commands longer than
240 characters.

For non-interactive Computer debugging, call `bds_execute_computer_command` with
an exact `c-xxxxxx` identity and one shell line. The command executes inside
that Computer's sandboxed shell and returns `stdout`, `stderr`, `exitCode`, and
modeled `cpuCycles`. It cannot reach the host shell or arbitrary BDS commands.
Input, output, concurrency, and timeout are bounded; vi/editor, sleep,
shutdown/reboot, and other TUI or asynchronous control flows return an explicit
unsupported result.

For a bounded Computer System Python comparison, pass `python <file>` or
`micropython <file>` through the same tool. This MCP-only form compiles and runs
the file with the target Computer's filesystem, hardware profile, and RAM limit.
It rejects waits and long-running work after a fixed cycle ceiling. Returned
machine-instruction counts are diagnostic only. The `cpuCycles` field is a
deterministic 486DX-equivalent cost shared with ASM, C, C++, and BASIC;
`run --stats` and Python/CS486 diagnostics also convert it to virtual
microseconds at 33 MHz. Do not use host wall-clock time for language rankings.

BDS prints `Server started` before Script API world initialization is fully
settled. The MCP session therefore applies the same bounded one-second startup
grace period as the established headless runner before it reports `running`.
This prevents the first probe from racing component registration.

## Browser terminal workflow

Run `npm run dev:bds:web` to start the managed BDS runtime and Web Terminal in a
single lifecycle. Use a Pocket Computer in Minecraft. The Behavior Pack emits a
session request, the companion returns a one-use 60-second URL through the
allowlisted relay, and Minecraft prints that URL to the requesting player.
Opening the URL connects the browser to the computer's fixed-cell terminal. The
URL is already bound to a `c-xxxxxx` Computer identity; the companion root page
cannot select an arbitrary Computer and the bearer token is never accepted for a
different identity.

For a one-action local workflow, set `WEB_COMPANION_AUTO_OPEN=1` before starting
the companion. A Pocket Computer use then opens the freshly minted `/p/...` URL
in the host's default browser. The launch does not use a command shell, is
serialized through a bounded queue, times out explicitly, and runs at most once
per handoff. Automatic opening is blocked unless both the listener and published
origin are loopback. The in-game URL is still emitted before the launch attempt,
so disabled, blocked, timed-out, and failed launches retain the normal fallback.

An MCP client that needs the URL itself can call `bds_wait_for_web_handoff` with
the exact `c-xxxxxx` Computer ID before the Pocket Computer is used. The wait is
bounded to at most 120 seconds and only one wait may own a Computer ID. A
matching handoff is returned to MCP instead of being sent to browser auto-open,
avoiding a race to consume the one-use URL. The URL remains absent from BDS logs
and unrelated Computer IDs cannot satisfy the wait.

The browser input is overlaid at the terminal cursor rather than rendered as a
separate form field. Physical Enter sends one bounded `terminal_line` event,
Ctrl+C invokes the interrupt endpoint, and Up/Down navigate browser-local
history. Closing the page, session expiry, player disconnect, BDS stop, and
relay failure each have an explicit finalization path.

When a vi status row is present, the browser prevents the semantic textarea from
editing locally and coalesces physical keys into batches of at most 16. The HTTP
companion and Bedrock bridge validate a hard maximum of 32 keys and 180 encoded
characters before queuing one `terminal_keys` VM event. Paste becomes editor
keys (newlines become Enter) and remains capped by the 1,024-key browser queue;
the next terminal snapshot explicitly returns to ordinary line mode after vi
closes.

The first browser attached to a Computer receives `CONTROL`. Later browser
sessions are `VIEW ONLY` and cannot send a line or interrupt until **Take
control** succeeds. Takeover, input, and close operations are serialized through
a bounded per-Computer queue. The previous writer is demoted when control moves,
and Bedrock emits `terminal_closed` only after the last browser session for that
Computer detaches. Sessions attached to different Computers remain independently
writable.

Loopback use requires no extra published port. LAN clients require TCP 19144 (or
the configured companion port) in addition to the BDS UDP port. Internet access
must use an HTTPS reverse proxy: bind the companion to `127.0.0.1`, set
`WEB_COMPANION_PUBLIC_ORIGIN`, and proxy only from the TLS endpoint. Do not
publish the plain HTTP listener directly.

## Verification rubric

- `Verify:` Run `npm run test:mcp`. `Expect:` MCP initialization, tool
  discovery, status output, command allowlisting, and explicit idle-state tests
  pass.
- `Verify:` Run `npm run validate`. `Expect:` Formatting, lint, type checking,
  host tests, and the pack build all pass.
- `Verify:` Run `npm run test:web`. `Expect:` One-use handoff, authentication,
  same-origin command submission, terminal streaming, session limits, and
  explicit close behavior pass.
- `Verify:` Set `WEB_COMPANION_AUTO_OPEN=1`, start the loopback companion, and
  use one Pocket Computer. `Expect:` The host default browser opens the minted
  handoff exactly once; the same fallback URL remains visible in Minecraft.
- `Verify:` Open two one-use links for the same Computer, attempt viewer input,
  choose **Take control**, and retry from both browsers. `Expect:` The second
  session begins `VIEW ONLY`; its first input is rejected; takeover promotes it,
  demotes the first session, and only the new writer can submit afterward.
- `Verify:` Close one of two sessions and then close the final session.
  `Expect:` The first close does not emit `terminal_closed`; the final close
  emits exactly one terminal finalization record.
- `Verify:` Start `npm run dev:bds:web`, use a Pocket Computer, open its link in
  a browser, type `ls` after the visible `~$ ` prompt, and press physical Enter.
  `Expect:` The command appears inline, submits once, and the next prompt
  appears at the following terminal row without a separate input box.
- `Verify:` Start a fresh Codex session, call `bds_start`, then call
  `bds_run_probe` with `headless/server` and wait for a `suite` terminal record.
  `Expect:` BDS reaches `running`, the suite emits `CS_PROBE_RESULT`,
  diagnostics remain inspectable through MCP, and `bds_stop` returns `idle`.
- `Verify:` Run `npm run test:mcp:bds` for the same workflow through a real MCP
  stdio client and the local BDS distribution. `Expect:` The command prints a
  JSON `PASS` summary with a passing suite record and final state `idle`.
