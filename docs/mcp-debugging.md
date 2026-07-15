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

| Variable                           | Default                                             | Purpose                                                        |
| ---------------------------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| `BDS_HOME`                         | `%USERPROFILE%\tmp\computer-system-bds\runtime`     | Extracted official BDS distribution used only as a copy source |
| `BDS_MCP_WORKDIR`                  | `%USERPROFILE%\tmp\computer-system-bds\mcp-runtime` | Isolated MCP debug runtime                                     |
| `BDS_MCP_PORT`                     | `19142`                                             | IPv4 server port; IPv6 uses the following port                 |
| `BDS_MCP_WORLD`                    | `ComputerSystemMcpDebug`                            | Debug world name                                               |
| `WEB_COMPANION_HOST`               | `0.0.0.0`                                           | Web listener interface for trusted LAN access                  |
| `WEB_COMPANION_PORT`               | `80`                                                | Web listener TCP port                                          |
| `WEB_COMPANION_PUBLIC_HOST`        | Listener host                                       | Reachable host used in generated HTTP links                    |
| `WEB_COMPANION_PUBLIC_ORIGIN`      | unset                                               | Complete HTTPS origin advertised behind a reverse proxy        |
| `WEB_COMPANION_CONFIG_FILE`        | system-wide platform path                           | Persistent administrator configuration file                    |
| `WEB_COMPANION_ALLOWED_ORIGINS`    | unset                                               | Extra origins, or `*` to accept every request Origin           |
| `WEB_COMPANION_AUTO_OPEN`          | automatic local-address match                       | `0` disables and `1` explicitly enables host-browser opening   |
| `WEB_COMPANION_DEBUG_IGNORE_RANGE` | `0`                                                 | Debug only: skip the placed-machine range and dimension check  |

No API key or `.env` file is required.

### Persistent administrator networking configuration

Use the host command below to persist the Web listener port and advertised
public origin across process and machine restarts:

```powershell
npm run web:config -- set --port 80 --url http://10.255.10.90
npm run web:config -- show
```

The default file is `%ProgramData%\Computer System\web-companion.json` on
Windows and `/etc/computer-system/web-companion.json` on Linux. The command
fails explicitly when the caller cannot write the system location, the port is
outside 1 through 65534, the URL is not an absolute HTTP(S) origin, or the JSON
contains an unknown field. Restart `npm run dev:bds:web` or the MCP companion
after changing the file. Use `--clear-port`, `--clear-url`, or `reset` to remove
settings. `WEB_COMPANION_PORT` and `WEB_COMPANION_PUBLIC_ORIGIN` override the
file for one process, which preserves isolated test and emergency recovery
workflows. Generated HTTP links omit `:80`. Explicit origins are URL-normalized,
so `http://host:80` is displayed as `http://host` and `https://host:443` is
displayed as `https://host`. The latter is valid only when a TLS reverse proxy
actually terminates HTTPS; the Node companion does not turn into an HTTPS server
merely by listening on TCP 443.

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

To grant one standard stationary Computer item during a controlled debug
session, first use `list` and require the intended player to be the only online
player. Then call `bds_run_probe` with `probe: "computer"` and
`target: "all_players"`. This dedicated path does not broaden `bds_run_command`
to arbitrary `give` or operator commands. If the inventory is full, the one item
is dropped at the player's location.

For non-interactive Computer debugging, call `bds_execute_computer_command` with
an exact `c-xxxxxx` identity and one shell line. The command executes inside
that Computer's sandboxed shell and returns `stdout`, `stderr`, `exitCode`, and
modeled `cpuCycles`. It cannot reach the host shell or arbitrary BDS commands.
Input, output, concurrency, and timeout are bounded; vi/editor, sleep,
shutdown/reboot, and other TUI or asynchronous control flows return an explicit
unsupported result.

Python and CS486 executable work is registered as a scheduler job and advances
on later BDS host ticks. The Script API console callback only validates and
enqueues the request; the single `CS_DEBUG_COMMAND` response is emitted after
the job reaches a completed, failed, limited, or detached terminal state.

Use `run --stats <program>` through this tool when comparing guest code. The
returned `stderr` preserves the CPU model line and the L1/L2 hit/miss, bus
transfer, unaligned-access, and pipeline-flush counters. This makes alignment
and locality benchmarks reproducible through MCP without scraping the Web
Terminal. CS-Linux authentication remains enforced for ordinary shell commands:
log in normally before using them. CS-DOS has no login gate.

Only one managed BDS may own a UDP port pair. When a development server is
already using `19142`/`19143`, set `BDS_MCP_PORT` to a free port whose following
port is also free; use a distinct `WEB_COMPANION_PORT` as well. Do not start two
BDS processes against the same work directory or world concurrently.

### Preserved-world upgrade workflow

Use `bds_start` with `resetWorld: false` to retain a managed debug world. A
world whose valid schema-2 identity registry is still encoded with schema-1
indexed pages is upgraded before Computer components or the Web bridge start.
Each paged load checks the current head before the immediately previous complete
generation. Referenced schema-1 Computer/filesystem snapshots are converted,
committed, and read back first; the identity registry is committed last. The
host spends at most one Dynamic Property read/write/delete on this migration per
tick.

For a deployment or irreplaceable debug world, do not rely on a live filesystem
copy:

1. Call `bds_stop`, require the returned state to be `idle`, and verify the BDS
   process and configured ports have closed.
2. Copy the entire stopped
   `%USERPROFILE%\tmp\computer-system-bds\mcp-runtime\worlds/<level-name>`
   directory to a timestamped backup. Do not edit individual LevelDB keys.
3. Start with `resetWorld: false`. Inspect bounded logs for transition-only
   `CS_STORAGE_MIGRATION` records. A pending record includes the phase and
   completed/total Computer counts; the terminal record is either `complete`
   with migrated/skipped/missing counts or `failed` with its phase and error.
4. Do not issue Computer, Web handoff, or shell probes until migration is
   complete. On failure, stop BDS and preserve both the original backup and the
   failed world for diagnosis.
5. After success, verify representative files and profiles, stop and restart the
   preserved world, and require a complete no-conversion startup.

An interrupted run remains safe because the legacy identity head is not replaced
until every referenced Computer generation has been verified. Restarting rescans
the registry and skips any Computer generation already in the current format.
Corruption of both the current and previous candidates reaches an explicit
failure instead of activating a partial registry.

For a bounded Computer System Python comparison, pass `python <file>`,
`micropython <file>`, or `python -c <source>` through the same tool. The inline
form accepts a multiline source string in the MCP JSON request; the relay
percent-encodes it into one BDS console line and rejects line breaks for every
other command. The source is compiled in memory at `/tmp/__mcp_inline__.py` and
does not create that file. These non-TUI forms use the target Computer's
filesystem, hardware profile, and RAM limit and reject waits or long-running
work after a fixed cycle ceiling. The normal CS-Linux Web Terminal separately
supports foreground `python <file>`, `python --stats <file>`, and the
`micropython` alias; that operator path may wait for guest events and supports
Ctrl+C. Returned machine-instruction counts are diagnostic only. The `cpuCycles`
field is the deterministic modeled CPU cost shared with ASM, C, C++, and BASIC;
`run --stats` and Python/CS486 diagnostics also convert it to virtual
microseconds at the selected hardware clock. Do not use host wall-clock time for
language rankings. Ordinary MCP shell commands still require a completed
CS-Linux login. The isolated Python compile/run probe is a separate
managed-debug operation and does not authenticate the interactive shell.

BDS prints `Server started` before Script API world initialization is fully
settled. The MCP session therefore applies the same bounded one-second startup
grace period as the established headless runner before it reports `running`.
This prevents the first probe from racing component registration.

## Browser terminal workflow

Run `npm run dev:bds:web` to start the managed BDS runtime and Web Terminal in a
single lifecycle. The companion selects a physical LAN IPv4 address unless
`WEB_COMPANION_PUBLIC_HOST` overrides it. Using an eligible Computer prints the
stable entry page and that Computer's permanent four-digit number. The
interaction activates the number once for two minutes. Entering it exchanges the
activation for a browser bearer token bound to the exact `c-xxxxxx` identity.
Invalid guesses are limited to eight attempts per client per minute, and an
active number collision returns an explicit conflict.

For a one-action workflow on the companion host, leave `WEB_COMPANION_AUTO_OPEN`
unset. A Desktop/Advanced block interaction or Portable Computer System use
opens the activated `/p/NNNN` path through loopback when the published host is a
literal address assigned to a local network interface and no custom public
origin is configured. Set the flag to `0` to disable this behavior or `1` to
enable it explicitly while retaining the locally reachable-listener requirement.
The launch does not use a command shell, is serialized through a bounded queue,
times out explicitly, and runs at most once per activation. This checks the
server endpoint rather than the initiating player's IP. The server cannot launch
a browser on another player's device; remote players use the printed LAN entry
page and four digits. Disabled, timed-out, and failed host launches retain that
fallback.

An MCP client can call `bds_issue_web_handoff` with the exact `c-xxxxxx`
Computer ID to issue and receive the one-use URL in one operation. The managed
debug server must have exactly one connected player; zero or multiple players, a
missing Computer identity, relay failure, and timeout all terminate with an
explicit error. The tool installs the Computer-scoped waiter before asking
Bedrock to create the session, so the request cannot outrun the waiter.

Use `bds_wait_for_web_handoff` instead when an operator will trigger the machine
interaction separately. Both tools bound the wait to at most 120 seconds, and
only one pending operation may own a Computer ID. A matching handoff is returned
to MCP instead of browser auto-open, avoiding a race to consume the one-use URL.
The URL remains absent from BDS logs and unrelated Computer IDs cannot satisfy
the wait.

Placed-machine sessions recheck the requesting player against the access block
during attachment, input, completion, resize, and snapshot work. Moving beyond
three blocks or changing dimension pauses the bounded session as `out_of_range`;
returning transitions it to `in_range` and resumes the existing browser stream.
After a successful connection the browser remembers only the permanent
four-digit number and updates the URL to `/?computer=NNNN`. Reloading that
bookmark rotates the bearer token through one deduplicated exponential-backoff
reconnect loop. The query never contains the bearer token. Range messages are
transition-only, and the permanent-code session index avoids a linear scan. A
held Portable remains exempt because the access point moves with its owner.

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

Every newly opened browser session receives `CONTROL` and atomically demotes the
previous writer to `VIEW ONLY`. A demoted session cannot send a line or
interrupt until **Take control** succeeds. Takeover, input, and close operations
are serialized through a bounded per-Computer queue. The previous writer is
demoted when control moves, and Bedrock emits `terminal_closed` only after the
last browser session for that Computer detaches. Sessions attached to different
Computers remain independently writable.

LAN clients require TCP 80 (or the configured companion port) in addition to the
BDS UDP port. Internet access must use an HTTPS reverse proxy: bind the
companion to `127.0.0.1`, set `WEB_COMPANION_PUBLIC_ORIGIN`, and proxy only from
the TLS endpoint. The configured custom origin and the host's loopback auto-open
origin are accepted explicitly. Set `WEB_COMPANION_ALLOWED_ORIGINS=*` when
arbitrary proxy domains must be accepted; bearer authentication and handoff
limits remain enforced. Do not publish the plain HTTP listener directly.

## Verification rubric

- `Verify:` Run `npm run test:mcp`. `Expect:` MCP initialization, tool
  discovery, status output, command allowlisting, explicit idle-state tests, and
  lossless `run --stats` microarchitecture output pass.
- `Verify:` On free dedicated BDS/Web ports and a new dedicated
  `BDS_MCP_WORKDIR`, run `npm run test:mcp:serial:bds`. `Expect:` MCP starts an
  isolated real BDS, the `serial_matrix` probe reports three machines, six
  faces, 36 ordered links, and 72 successful bidirectional Linux ttyS/DOS COM
  transmissions, then the suite passes and BDS returns to `idle`.
- `Verify:` Run `npm run validate`. `Expect:` Formatting, lint, type checking,
  host tests, and the pack build all pass.
- `Verify:` Run
  `npx vitest run tests/phase0/transactionalPagedStore.test.ts tests/computer/snapshotMigration.test.ts tests/computer/storageMigration.test.ts`.
  `Expect:` Schema-1 page and snapshot conversion, current-head-first fallback,
  one-operation tick slicing, identity-last activation, explicit corruption
  failure, restart idempotence, and fresh-world no-op behavior pass.
- `Verify:` Back up a stopped legacy-format managed world, call `bds_start` with
  `resetWorld: false`, and wait for `CS_STORAGE_MIGRATION` logs. `Expect:` The
  status reaches `complete` before Computer/Web behavior starts, preserved data
  remains readable, and the next stopped-world restart performs no conversion.
- `Verify:` Run `npm run test:web`. `Expect:` One-use handoff, authentication,
  same-origin command submission, terminal streaming, session limits, and
  explicit close behavior pass.
- `Verify:` Publish through a literal IP assigned to the companion host, leave
  `WEB_COMPANION_AUTO_OPEN` unset, and use one Portable Computer System.
  `Expect:` The host default browser opens the minted loopback handoff exactly
  once, status reports policy `local_address`, and the same fallback URL remains
  visible in Minecraft.
- `Verify:` Open two activations for the same Computer and attempt input from
  both browsers. `Expect:` The second session begins in `CONTROL`, the first is
  atomically demoted to `VIEW ONLY`, and only the new writer can submit. Choose
  **Take control** in the first browser and confirm the lease moves back.
- `Verify:` Close one of two sessions and then close the final session.
  `Expect:` The first close does not emit `terminal_closed`; the final close
  emits exactly one terminal finalization record.
- `Verify:` Start `npm run dev:bds:web`, use a Portable Computer System, open
  its link in a browser, type `ls` after the visible `~$ ` prompt, and press
  physical Enter. `Expect:` The command appears inline, submits once, and the
  next prompt appears at the following terminal row without a separate input
  box.
- `Verify:` Start a fresh Codex session, call `bds_start`, then call
  `bds_run_probe` with `headless/server` and wait for a `suite` terminal record.
  `Expect:` BDS reaches `running`, the suite emits `CS_PROBE_RESULT`,
  diagnostics remain inspectable through MCP, and `bds_stop` returns `idle`.
- `Verify:` Run `npm run test:mcp:bds` for the same workflow through a real MCP
  stdio client and the local BDS distribution. `Expect:` The command prints a
  JSON `PASS` summary with a passing suite record and final state `idle`.
