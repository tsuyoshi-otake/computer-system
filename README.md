# Computer System

Computer System is a ComputerCraft-inspired programmable computer add-on for
Minecraft Bedrock Edition.

The project aims to reproduce the ComputerCraft experience as closely as the
Bedrock Add-On and Script APIs allow. Desktop programs can use a sandboxed,
MicroPython-compatible language called Computer System Python. The portable DOS
profile instead supports ASM, C, C++, CS QBASIC, and bounded batch programs. The
computer lifecycle, terminal, filesystem, events, networking, peripherals,
portable computers, and turtles follow ComputerCraft-style behavior.

<table>
  <tr>
    <td align="center"><img src="web/assets/manual/desktop-computer-system.png" alt="Desktop Computer System concept sheet showing a 486DX 33 MHz system unit, CRT, keyboard, mouse, and floppy drives" height="400"></td>
    <td align="center"><img src="web/assets/manual/portable-computer-system.png" alt="Portable Computer System concept sheet showing its DOS terminal, keyboard, trackball, ports, battery, and 386SX 16 MHz with 2 MB RAM specification" height="400"></td>
  </tr>
  <tr>
    <td align="center"><b>Desktop Computer System</b><br>Linux-style workstation concept</td>
    <td align="center"><b>Portable Computer System</b><br>386SX 16 MHz / 2 MB DOS mobile concept</td>
  </tr>
</table>

The Web Terminal Manual's architecture chapter also includes the authored
machine plates in `web/assets/machines/` and the CS386SX, CS486DX, and CS486DX2
identification plates in `web/assets/cpu/`. The machine plates remain the single
source for the pack's 256 px transparent inventory icons; the build performs a
bounded conversion instead of maintaining separate hand-copied textures.

## Status

The Phase 2 Bedrock Computer vertical slice is implemented. The language, VM,
scheduler, computer lifecycle, terminal model, filesystem, persistence, redstone
adapters, portable computer identity, monitor fallback, and bounded Bedrock
probes are covered by host and Bedrock Dedicated Server verification.

The first public build is
[v0.1.0-alpha.1](https://github.com/tsuyoshi-otake/computer-system/releases/tag/v0.1.0-alpha.1).
It is an alpha preview of the implemented Phase 2 slice, not the later Phase 6
release-hardening milestone. Back up an existing world before testing it.

The repository also includes a local stdio MCP companion that can build the
packs, run an isolated BDS instance, execute allowlisted Computer System probes,
return bounded server logs, acquire a computer-scoped one-use Web handoff, and
execute bounded non-TUI shell commands inside an exact `c-xxxxxx` Computer. The
real MCP-to-BDS headless workflow passes with zero diagnostics.

The production interaction path uses the local Web Terminal companion. It does
not fall back to the native in-game terminal when the companion is unavailable;
instead, it reports an explicit retryable error. Using a Portable Computer
System activates its permanent four-digit connection number for two minutes and
connects the browser directly to the same fixed-cell terminal model. The Web
Terminal provides a full-width Linux-style screen, inline cursor-positioned
input, physical Enter, selection-aware copy and Ctrl+C, bounded plain-text
paste, and command history without relying on Bedrock's narrow CustomForm
container. Interactive commands use a targeted bounded snapshot path, so their
visible response does not wait for every viewer in the periodic round-robin.

On the DOS profile, `EDIT [path]` opens an original DOS-era full-screen editor.
Running `EDIT` by itself starts an `UNTITLED` buffer backed by `C:\NONAME.TXT`.
It provides a blue fixed-cell editing surface, File/Edit/Search/Options/Help
menus, cursor navigation, insert/overwrite modes, bounded undo and search,
F2/Ctrl+S save, and an explicit Save/Discard/Cancel exit state. `vi` remains the
syntax-highlighted modal editor for Linux and DOS; Linux deliberately does not
expose `EDIT`. Both editors use the same writer-owned bounded key transport and
render inside the fixed 80x25 Web Terminal hardware text grid.

The Web Terminal header also opens a searchable, keyboard-navigable 16-chapter
field manual. Goal paths lead new operators through a first program, a
Python-and-Redstone project, CS-Linux operation, native development, Portable
CS-DOS operation, or diagnosis without changing the canonical publication order.
Four visible parts group startup and operation; building and peripherals;
architecture, compiled languages, and optimization; then profiles, recovery, and
reference. Section-level results identify tutorials, how-to material, concepts,
and reference entries while Previous/Next controls and arrow keys continue to
follow publication order.

The same publication is available as a static reference from the
[Computer System GitHub Pages site](https://tsuyoshi-otake.github.io/computer-system/).
`web/manual.js` remains the only authored source for its 16 chapters, stable
section IDs, reading paths, and bounded search. The Pages build pre-renders that
source so the complete manual, table of contents, and hash links remain usable
without JavaScript. GitHub Pages is documentation only: it cannot connect to
BDS, accept a four-digit Computer number, obtain a bearer token, display a live
terminal, or submit guest input. Use the local companion for those operations.

See [the implementation roadmap](docs/roadmap.md) for the planned compatibility
scope and executable acceptance criteria.

Development setup and Phase 0 evidence are documented in
[the development guide](docs/development.md) and
[the feasibility matrix](docs/feasibility-matrix.md). Player-experience checks
are intentionally isolated in the
[manual verification checklist](docs/manual-verification.md).

## Requirements

- Node.js 24 or later
- Minecraft Bedrock Edition 1.26.30 or later in the 1.26 release line
- The official Bedrock Dedicated Server distribution for BDS verification

The current package baseline uses `@minecraft/server` 2.8.0,
`@minecraft/server-ui` 2.1.0, and `@minecraft/vanilla-data` 1.26.33.

## Install the alpha preview

1. Download
   [`computer-system-0.1.0-alpha.1.mcaddon`](https://github.com/tsuyoshi-otake/computer-system/releases/download/v0.1.0-alpha.1/computer-system-0.1.0-alpha.1.mcaddon).
2. Open the downloaded file with Minecraft for Windows to import both packs.
3. In the target world's settings, activate the Computer System Behavior Pack.
   Its declared dependency activates the matching Resource Pack.
4. Keep a stopped-world backup while this alpha release is under evaluation.

The combined `.mcaddon`, separate Behavior/Resource `.mcpack` files, and
`SHA256SUMS.txt` are attached to the GitHub Release. Live Web Terminal access
still requires the local companion from the source repository; GitHub Pages is
the static manual only.

## Quick start

```powershell
npm install
npm run validate
```

`npm run validate` checks formatting, lint, TypeScript types, host tests, and
the production Behavior and Resource Pack build. Build artifacts are written
under `dist/`.

Useful development commands:

```powershell
npm run build
npm run build:release
npm run deploy
npm run test:bds
npm run test:bds:disconnect
npm run test:mcp
npm run test:mcp:bds
npm run test:web
npm run build:pages
npm run test:pages
npm run dev:bds:web
```

`npm run build:pages` writes the static landing page and manual to
`dist/pages/`. The builder publishes an explicit allowlist of the site
presentation files and `web/assets/`; it reads the canonical manual module but
never copies the Web Terminal entry page, terminal application, session storage,
or `/api/*` client. `npm run test:pages` checks the 16-chapter projection,
base-path-safe links and assets, no-JavaScript fallback, search/deep links, SEO
metadata, and the absence of live-terminal controls.
`.github/workflows/pages.yml` performs the same build for pushes to `main` and
on manual dispatch. It deploys only `dist/pages` as the Pages artifact;
generated Pages output is not committed.

`npm run build:release` rebuilds both packs and writes deterministic `.mcpack`
and combined `.mcaddon` archives plus SHA-256 checksums under `dist/release/`.
Release packaging excludes repository guidance and JavaScript source maps from
the player-facing archives.

To accept every reverse-proxy Origin instead of pinning one domain, enable
explicit wildcard mode:

```powershell
$env:WEB_COMPANION_ALLOWED_ORIGINS = "*"
```

`npm run deploy` updates only this project's development pack directories in the
local Minecraft for Windows GDK creator-content location.

## Bedrock MCP debugging

The Resource Pack is static client content and cannot host an MCP transport.
Instead, the project-scoped [`.codex/config.toml`](.codex/config.toml) registers
the `computer_system_bds` stdio companion implemented by
[`tools/bds-mcp-server.mjs`](tools/bds-mcp-server.mjs).

Set `BDS_HOME` to an extracted official BDS distribution. The tooling treats
that directory as a read-only source and copies it into a managed runtime under
`%USERPROFILE%\tmp\computer-system-bds`; it never recursively deletes
`BDS_HOME`.

```powershell
$env:BDS_HOME = "C:\path\to\bedrock-server"
npm run test:mcp:bds
```

The real-BDS smoke requires a `linux_authentication/PASS` record in addition to
the overall suite result. That isolated probe rejects MCP work before login,
sets the initial password through masked terminal input, reboots, authenticates
as `cs`, confirms `whoami`, and shuts the probe Computer down. Its password is
never included in the result or BDS log record.

For interactive work, start the MCP-managed server with the debug world
preserved, connect Minecraft to the reported port, and run player-scoped probes
through MCP. On Windows installations where Minecraft rejects `127.0.0.1` with
`InitialConnection-13`, use the machine's active LAN IPv4 address instead. See
[the MCP debugging guide](docs/mcp-debugging.md) for the complete workflow and
safety constraints.

`bds_execute_computer_command` provides a direct debug path for a specific
Computer without using its TUI. It returns stdout, stderr, exit code, and
modeled CPU cycles for the target Computer's persisted hardware model from the
sandboxed shell; it never invokes host PowerShell/Bash or arbitrary BDS
administration commands. `bds_issue_web_handoff` asks the single connected debug
player to open one exact Computer ID and returns its one-use URL without a
physical machine interaction. `bds_wait_for_web_handoff` remains available when
an operator will trigger the interaction separately. Both paths prevent browser
auto-open from consuming the claimed URL first and bound input, concurrency,
output, and waits. The MCP direct `python <file>`, `micropython <file>`, and
bounded multiline `python -c <source>` forms run through the target Computer's
MicroPython-compatible compiler, filesystem, hardware profile, and RAM limit.
Only the inline Python debug form may contain encoded line breaks; ordinary
debug commands remain one line. The normal CS-Linux shell also accepts
`python <file>`, `python --stats <file>`, and the `micropython` alias as a
foreground process; it can wait for guest events and returns to the prompt on
completion, failure, or Ctrl+C. Python is compiled to CS486 control flow and an
allowlisted managed-runtime syscall ABI; there is no separate Python VM. The
non-TUI MCP execution path rejects waits and long-running work and reports
machine instructions, CPU cycles, and virtual time at the target Computer's
clock, using the same units as `run --stats`.

## Browser terminal

Start the combined BDS and Web Terminal companion, then connect Minecraft to the
reported Minecraft address and port:

```powershell
$env:BDS_HOME = "C:\path\to\bedrock-server"
npm run dev:bds:web
```

When `WEB_COMPANION_AUTO_OPEN` is unset, the companion automatically opens each
eligible one-use handoff only when the effective published host—detected
automatically or overridden by `WEB_COMPANION_PUBLIC_HOST`—is a literal IP
address assigned to the companion host and no custom public origin is
configured. A service published as `10.255.10.90` therefore opens the same path
through `127.0.0.1` in the server host's default browser. Set the flag to `0` to
disable host-browser opening or to `1` to request it explicitly while retaining
the locally reachable-listener check. This is a server-address check, not a
Minecraft player-IP check: an eligible remote player interaction may open the
browser on the server host, never on the remote player's device.

Interacting with a Desktop or Advanced Desktop Computer System activates browser
access only when exactly one Monitor is physically adjacent. A bare desktop is
selected but does not expose Web Terminal. The Portable Computer System has a
built-in display and opens the link while held or placed without an external
Monitor. The companion advertises a stable LAN entry page and Minecraft prints
the Computer's permanent four-digit number. Touching the machine activates that
number once for two minutes. Invalid codes are rate-limited per client, and a
simultaneous four-digit collision fails explicitly rather than connecting the
wrong Computer. Opening the entry page and entering the active number exchanges
it for a browser-only bearer token that is never written to BDS logs. The
authenticated session lasts at most 30 minutes. Placed machines remain usable
only while that player stays within three blocks; leaving the radius pauses
input as `out_of_range` without destroying the bounded session, and returning
resumes the existing browser stream. After the first successful connection the
browser stores only the permanent four-digit number in local storage and changes
the bookmarkable URL to `/?computer=NNNN`. Opening that bookmark rotates the
bearer token and reconnects through one deduplicated, 30-minute bounded
exponential-backoff loop. No bearer token or password is put in the query. Code
lookup is O(1), and access notifications are emitted only on range-state
transitions rather than on every scheduler check. A held Portable is the access
point itself and does not use the placed-block distance check.

For a local managed-BDS debugging session only, set
`WEB_COMPANION_DEBUG_IGNORE_RANGE=1` before starting the companion to skip the
placed-machine three-block and dimension check. The default remains enforced.
This flag does not bypass the initial machine interaction, player connection,
writer lease, bearer token, session lifetime, or disconnect finalization.

Each two-minute activation is already bound to one Computer; the companion root
page accepts only an active four-digit number, not an arbitrary Computer ID.
Newly created Computers use compact IDs in the form `c-xxxxxx`, where the
six-character lowercase Crockford Base32 payload is also the stable 30-bit value
returned by `os.getComputerID()`. Allocation checks the persisted identity
registry and retries collisions up to a fixed limit before failing explicitly.

Only one browser session can type into a given Computer at a time. The first
newly opened session receives `CONTROL` and atomically demotes the previous
writer to `VIEW ONLY`. A demoted viewer can use **Take control** to reclaim the
lease. Input and interrupts from viewers are rejected by both the companion and
Bedrock bridge, and closing one view does not emit `terminal_closed` while
another view of the same Computer remains active. Different Computers remain
independently writable.

The BDS Web companion listens on `0.0.0.0:80` by default and chooses a
non-virtual LAN IPv4 address for the entry page. Trusted LAN clients therefore
need TCP 80 in addition to the BDS UDP port. Override the detected address when
the host has unusual routing:

```powershell
$env:WEB_COMPANION_PUBLIC_HOST = "192.168.1.10"
npm run dev:bds:web
```

An administrator can persist a different listener port and complete public
HTTP(S) origin without editing repository files or recreating environment
variables on every boot:

```powershell
npm run web:config -- set --port 80 --url http://10.255.10.90
npm run web:config -- show
npm run dev:bds:web
```

On Windows the default system-wide file is
`%ProgramData%\Computer System\web-companion.json`; on Linux it is
`/etc/computer-system/web-companion.json`. Run the configuration command with
the permissions required to write that location. `--clear-port` and
`--clear-url` restore the corresponding default, while `reset` removes the
complete persisted configuration. A restart is required after any change.
`WEB_COMPANION_PORT` and `WEB_COMPANION_PUBLIC_ORIGIN` remain temporary
per-process overrides and take precedence over persisted values. Use
`WEB_COMPANION_CONFIG_FILE` to select a different configuration file; an empty
value disables persisted configuration for an isolated test process. Displayed
origins omit standard ports: HTTP 80 is shown as `http://host` and an explicit
HTTPS origin on 443 is shown as `https://host`. The companion itself is plain
HTTP; an HTTPS origin requires a real TLS reverse proxy rather than merely
binding the companion to TCP 443.

Minecraft/BDS and the Web Terminal use different transports: the managed BDS
defaults to UDP 19142, while the browser companion defaults to TCP 80. For
Internet access, keep the companion bound to loopback and put an HTTPS reverse
proxy on TCP 443 in front of it:

```powershell
$env:WEB_COMPANION_HOST = "127.0.0.1"
$env:WEB_COMPANION_PUBLIC_ORIGIN = "https://terminal.example.com"
npm run dev:bds:web
```

Do not expose the plain HTTP companion port directly to the Internet. The
reverse proxy should terminate TLS and forward only to `127.0.0.1:80`.
State-changing terminal requests normally accept the exact configured public
origin and the companion host's loopback auto-open origin. Wildcard mode accepts
every Origin but still requires a valid terminal bearer token; use it only when
the deployment intentionally permits arbitrary proxy domains.

### Publishing through Cloudflare

Keep the companion on local HTTP port 80 and persist the public HTTPS URL first.
The standard HTTPS port is intentionally omitted from the URL shown to users:

```powershell
npm run web:config -- set --port 80 --url https://terminal.example.com
```

Restart the companion after changing the configuration. Configure the process or
Windows service with `WEB_COMPANION_HOST=127.0.0.1` so the plain HTTP listener
is not exposed beyond the host.

#### Pattern A: Cloudflare Tunnel (recommended)

1. In the Cloudflare dashboard, open **Networking > Tunnels**, create a
   Cloudflare Tunnel, and add a published application route for
   `terminal.example.com`.
2. Set the route's service URL to `http://127.0.0.1:80`. Cloudflare serves the
   public hostname over HTTPS while `cloudflared` reaches the companion through
   loopback.
3. Install the connector on the Computer System host using the command supplied
   by the dashboard. On Windows this has the following form and must run from an
   Administrator terminal:

   ```powershell
   cloudflared.exe service install <TUNNEL_TOKEN>
   ```

4. Keep the tunnel token out of Git, logs, screenshots, and repository `.env`
   files. No inbound Internet firewall rule for companion TCP 80 is required;
   the connector establishes outbound tunnel connections.
5. Open `https://terminal.example.com` and confirm that the Web Terminal entry
   page loads. Cloudflare Access can be placed in front of the hostname as an
   additional operator-controlled authentication layer.

See Cloudflare's official guides for
[creating a remotely managed tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
and the
[Cloudflare Tunnel architecture](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/).

#### Pattern B: proxied DNS with Full (strict)

Use this pattern when the origin must accept direct Cloudflare proxy traffic
instead of running `cloudflared`:

1. Keep the companion on `127.0.0.1:80` and place Caddy, nginx, IIS, or another
   TLS reverse proxy on origin TCP 443.
2. Install a publicly trusted certificate or a
   [Cloudflare Origin CA certificate](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)
   on that reverse proxy, then forward requests to `http://127.0.0.1:80`.
3. Create a proxied Cloudflare DNS record for `terminal.example.com` and set the
   zone's SSL/TLS encryption mode to
   [Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/).
4. Restrict origin TCP 443 to Cloudflare's networks or use an equivalent
   authenticated-origin control. Do not expose companion TCP 80 publicly.

Do not use Cloudflare **Flexible** mode for the Web Terminal. Flexible leaves
the Cloudflare-to-origin connection on HTTP, which is inappropriate for a
password-authenticated terminal. Cloudflare also recommends Full or Full
(strict) whenever possible; see its
[SSL/TLS encryption mode guidance](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/).

## CS-Linux and CS-DOS

Terminal commands execute inside the Computer System sandbox, never in the host
Windows or BDS process. Computer System Linux 1.0 (`CS-Linux 1.0`) boots a
non-destructive Linux profile with `/etc`, `/dev`, `/tmp`, `/usr`, `/var`, and
`/home/cs`. Existing files are preserved while `/tmp` is explicitly volatile.
The initial account is `cs` at UID/GID 1000 with `/home/cs` and membership in
the `sudo` group. Root is UID/GID 0 and starts password-locked. On first boot,
CS-Linux asks for the `cs` password twice; later boots stop at `login:` and then
`Password:` so any unlocked account can authenticate. Bounded salted SHA-256
records are stored in `/etc/shadow`, never plaintext, and secret Web input is
masked, excluded from local history, and excluded from completion. Three failed
attempts incur a two-second guest delay. Every OS boot resets only the terminal
display buffer before printing the minimal OS identity and prompt; persisted
files and the account database remain intact.

The state model, persistence projection, limits, and verification rubric are
specified in [`docs/os-presence.md`](docs/os-presence.md).

After authentication, the prompt is `<login>@<computer-id>:<path>$` (or `#` for
effective UID 0). CS-Linux shows the previous login when one exists, reads the
real `/etc/motd`, and loads the authenticated user's `.bash_history`. History is
bounded to 100 entries, 512 UTF-8 bytes per line, and 32 KiB total, and is saved
as a mode-0600 regular file on logout or disconnect. Passwords and other secret
conversation input never become history entries.

Each running Computer owns one bounded OS runtime state. PID 1 is
`/sbin/cs-init`; the `cs-login` service owns a waiting getty, and every login
shell and admitted Python/CS486/background task has an explicit PID, PPID,
UID/GID, state, start tick, and modeled CPU-cycle account. `ps`/`ps -f` and the
single-snapshot `top` inspect that table. `kill` supports HUP, INT, TERM, KILL,
STOP, and CONT with guest ownership checks, while `jobs`, `fg`, `bg`, and `wait`
operate only on jobs owned by the current login shell. A trailing `&` is
admitted only for one interactive `sleep`, `python`/`micropython`, or `run`
command; pipelines, redirects, scripts, aliases, functions, MCP submissions, and
other commands are rejected before side effects. The default ceilings are 64
processes and 32 jobs per Computer.

When the final terminal session disconnects, CS-Linux cancels any secret prompt,
drops nested `sudo`/`su` identity state and the sudo timestamp, cancels any
credential-capturing foreground Python/CS486 process, compiler job, or queued
MCP guest job, and returns to `login:`. The runtime owns this finalization even
when the guest program ignores `terminal_closed`; reconnecting never inherits an
unattended root shell or resumes work with stale elevated credentials.

`/etc/passwd`, `/etc/group`, and `/etc/shadow` are the bounded authoritative
account database. `passwd` changes credentials; `useradd`, `userdel`, and
`usermod` manage users; `groupadd` and `groupdel` manage groups. Account and
group mutations require superuser privilege. Raw writes, links, moves, metadata
changes, and removals of these managed files are rejected even for root; the
account commands are their only mutation boundary and commit them together. A
member of `sudo` authenticates with that member's own password to run a command
with scoped effective root privilege. `su` instead authenticates the target
account and changes the active login context until that nested session exits.
The locked root account cannot be used for password login or `su` until an
administrator deliberately assigns it a password.

The legacy name `computer` is permanently reserved for both users and groups, so
a current account can never be confused with migration input. One user may have
at most 32 supplementary groups. An attempt to add a 33rd is rejected
transactionally without changing any account file. Default `useradd` home
provisioning recursively creates missing ancestors, but the account records and
the complete new home tree are one all-or-nothing operation: capacity or
filesystem failure leaves neither the account nor partial directories.

UID 1000 is also the persisted boot-service identity for `/startup.py` and is
resolved from the authoritative account database on every boot. Its login name
and home may be changed only while the account is inactive, but `userdel` cannot
remove that UID. A fresh desktop boot creates an empty, mode-0644 `/startup.py`
owned by UID/GID 1000 while keeping `/` root-owned and non-writable. An empty
file selects the built-in shell boot program; once the user saves source there,
later boots execute that source with the same current UID 1000 account and
supplementary groups.

Every guest filesystem entry point enforces Linux owner/group/other permissions,
directory traversal, ownership rules, sticky-directory deletion, protected hard
links, and the active `umask` (initially `022`). Newly created entries receive
the caller's effective UID/GID, root owns system paths, and setuid/setgid bits
do not grant hidden credentials. Mode, UID, GID, modification time, symbolic
links, hard-link groups, and deletion tombstones persist in backward-compatible
filesystem snapshots.

The supported legacy migration is complete rather than an alias. A recognized
`computer` account is renamed to `cs`, `/home/computer` is moved to `/home/cs`,
and the old passwd/group/shadow name and home path disappear. No compatibility
user or symlink is retained. The exact existing password payload, UID/GID, file
contents, modes, ownership, mtimes, symbolic links, hard-link identities, and
tombstones are preserved. A conflicting destination fails explicitly instead of
merging unrelated data, and restarting after a completed migration is
idempotent. The old `computer` user and group names remain reserved after that
success; administrators cannot recreate or rename an account or group to them.

Startup scans each Computer referenced by the identity registry even when that
registry already uses the current paged-store format. A Computer payload that
needs a cold OS/DOS-state upgrade is saved and reload-verified independently; an
already-current healthy identity head is left untouched. If a current-format
head is corrupt or incomplete but its immediately previous generation validates,
the recovered Computer or identity payload is saved back into that head slot and
reload-verified with `recovered: false` before startup completes. Interrupted
work resumes by rescanning, so the same Computer keeps its identity and
completed payloads are not rewritten.

The same state owns login sessions, the last 64 login records, at most eight
active sessions, 32 services, 16 mounts, 64 devices, and a bounded journal. Use
`tty`, `who`, `w`, and `last` for session state; `service --status-all` or
`service <name> status` for read-only service status; and `man`/`apropos` for
the installed, versioned guest manual index. Service start/stop/restart is owned
by `cs-init` and is not an operator command in this release.

`shutdown` and `reboot` are multi-phase state transitions rather than immediate
power cuts. New guest and block-I/O admission stops first; owned work receives a
terminal signal, already-admitted block I/O drains, the Computer crosses a real
data-persistence boundary, unmounts active mounts, stops services and devices,
crosses a final persistence boundary, and only then powers off or reboots. Each
phase has a 200-tick deadline. A failed durability or drain boundary faults the
machine visibly instead of claiming a clean shutdown. Immediately before the
final callback, the runtime records `final sync requested` and that the shutdown
or reboot phases are prepared for final persistence. Those neutral records are
part of the saved cold projection exactly once; no unsaved success message is
added after the callback. If marker creation or the final callback fails, the
runtime removes only that attempt's provisional markers before publishing the
fault. A later automatic dirty-record save therefore cannot turn a failed
boundary into apparent success. `sync` uses the same real host persistence
boundary and returns failure when that boundary is unavailable. The runtime also
exposes a one-shot safe-boot boundary that preserves but bypasses a broken
`/startup.py`. When a Computer is `crashed`, its Web Terminal power control
changes to safe boot. In Minecraft, sneak while opening that crashed Computer;
opening it normally prints the same recovery instruction. Neither path deletes,
renames, or rewrites the startup file, and safe boot is not available from the
guest shell or MCP command path.

The same per-Computer state has an empty-by-default integration boundary for a
future guest NIC: at most eight interfaces, 32 addresses, and 64 sockets. It
validates loopback/Ethernet identity, IPv4/IPv6 addresses, link transitions,
nonnegative counters, and TCP/UDP open/bind/listen/close state through
Map-backed indexes. This is internal state ownership, not a shipped network
stack or command surface.

A profile boundary separates path syntax, boot layout, environment, and virtual
devices. Closed-by-default Linux and DOS command registries own public names,
completion, and help, while separate syntax frontends own expansion and errors.
The implemented DOS profile shares the same terminal, filesystem, persistence,
hardware limits, and checked CS executable/toolchain abstractions without Linux
conditionals in the domain core. It starts at `C:\>` without creating a
Linux-like `C:\USERS` hierarchy and provides drive-letter paths,
case-insensitive strict 8.3 names, CRLF boot files, `NUL`/`CON`, and DOS command
aliases. Invalid long names fail explicitly instead of being silently truncated.
DOS-facing commands use CRLF and DOS-specific status/error text rather than
leaking Linux applet output. The implemented compatibility surface includes
`DIR`, `TYPE`, `COPY`, `DEL`/ `ERASE`, `MD`, `RD`, `MOVE`, `REN`/`RENAME`,
`TREE`, `VOL`, `VER`, `TIME`, `TIMER`, `DOSKEY /HISTORY`, `MEM /F`, `ATTRIB`,
`LABEL`, and read-only `CHKDSK`. Computer System DOS 6.2 (`CS-DOS 6.2`) reads a
bounded `CONFIG.SYS` and runs `AUTOEXEC.BAT`; `SET`, `PATH`, `PROMPT`, `REM`,
`@ECHO OFF`, `%0`…`%9`, `%VAR%`, and `%ERRORLEVEL%` are supported. Unsupported
boot directives fail visibly. `DEVICE`/`DEVICEHIGH` enables the modeled HIMEM or
EMM386 state only after the referenced installed guest file begins with the
expected versioned CS-DOS driver capsule; a missing, deleted, or corrupt file
fails before changing memory state.

The DOS runtime owns A: and C:, the active drive, a separate current directory
for each drive, media generations, volume labels, and FAT metadata. Production
C: is persistent; A: is backed by the removable `computer_system:floppy_disk`
item and reports not ready while its bay is empty. Cold restore never invents an
A: medium. `FORMAT A:` creates a 1.44 MiB FAT12 volume, `FORMAT A: /S` or
`SYS A:` installs the bounded CS-DOS system files, and `EJECT [A:]` returns the
same identity-carrying item. A bootable disk takes boot priority unless one-shot
safe boot was requested. On a Linux-installed machine that boot is an ephemeral
A:-only DOS session: C: is unavailable and the Linux filesystem and OS snapshots
are not changed. `DIR`, `COPY`, `DEL`/`ERASE`, and `REN`/`RENAME` support
bounded DOS `*`/`?` file specifications and use each file's persisted two-second
FAT timestamp. `DIR /A` filters read-only, hidden, system, directory, and
archive state. `ATTRIB` displays or changes R/H/S/A (including bounded `/S`),
and read-only state is enforced by write, delete, rename, copy, and editor
paths. `LABEL` reads or changes the generation-bound volume label. `CHKDSK`
reports actual file/directory/byte/free counts and metadata consistency but
never repairs the volume. It does not alter guest file contents, labels, or
attributes, although reading a legacy entry may materialize its missing
versioned FAT metadata.

Single-path writes, `MD`/`RD`, the shipped wildcard `COPY`, `REN`/`RENAME`, and
`DEL`/`ERASE` paths, plus `MOVE` and `ATTRIB`, trial their complete FAT
aggregate on a clone before commit. Filesystem bytes, inode/link indexes,
metadata, byte and blob accounting, and FAT state then share one bounded undo
transaction; nested wildcard writes reuse the outer filesystem snapshot.
Capacity rejection and injected post-mutation write, delete, rename, move,
attribute, directory, FAT, and persistence-observer failures prove that both
aggregates return to their exact pre-command snapshots and revisions. Drive
selection, per-drive current directories, the displayed prompt, labels, and
lazily synthesized FAT metadata use that observer-owned boundary too; if
publication fails, the old aggregate is republished. All operands of one
multi-path `MD` commit or roll back together. Transaction callbacks are strictly
synchronous: declared async callbacks are rejected before execution, while a
callback that disguises a Promise is rolled back and its filesystem/DOS scope is
quarantined until settlement so post-`await` mutation cannot leak. The shared
quarantine blocks every managed filesystem and DOS aggregate during that window,
so a continuation cannot escape through a second owner after its callback stack
unwinds.

The bounded BAT interpreter supports labels, `GOTO`, `GOTO :EOF`, internal and
external `CALL`, `SHIFT`, `IF [NOT] ERRORLEVEL`, `IF [NOT] EXIST`, and
`COMMAND /C` or `/K`. It caps lines and labels at 256, positional arguments at
nine, call depth at eight, jumps at 1024, executed steps at 4096, loaded
programs at 64, expanded commands at 4096 characters, and output at 256,000
characters. This is not native COMMAND.COM or `.COM`/`.EXE` execution. Unquoted
Unix-style `&&` and `||` chains are rejected inside BAT control flow. Pipes and
redirections remain documented safe-shell extensions, not claims of native
COMMAND.COM semantics.

```text
files:  pwd cd ls cat mkdir rmdir touch rm cp mv ln readlink realpath find stat
text:   echo printf head tail wc grep sort uniq tr cut seq tee cmp diff xargs
inspect: file sha256sum od hexdump df du quota mount dmesg
shell:  sh bash source env printenv export unset alias unalias command read
identity: whoami id groups passwd su sudo login logout getent
accounts: useradd userdel usermod groupadd groupdel
process: ps top kill jobs fg bg wait tty who w last service
manual: man apropos
info:   hostname uname date uptime cpuinfo free
system: clear vi history time sleep test [ umask sync shutdown reboot exit true false
DOS:    EDIT DIR ATTRIB LABEL CHKDSK TREE VOL TIME TIMER DOSKEY MEM DEBUG + aliases
toolchain: as cc c++ ld nm run objdump csdb (QBASIC and DEBUG on DOS)
```

The parser supports single and double quotes, backslash escapes, environment
variables, `$?`, pipelines (`|`), input/output redirection (`<`, `>`, `>>`), and
control operators (`&&`, `||`, `;`). Computer System Bash adds shebangs,
positional parameters, conditionals, bounded loops, functions,
`break`/`continue`/`return`, `source`, aliases, `command`, `read`,
function-local variables, `shift`, and basic `getopts`. After authentication it
loads `/etc/profile`, `/etc/bash.bashrc`, and then that account's `~/.bashrc`
without replacing existing user files. Command length, tokens, pipeline stages,
script depth/lines/iterations, and intermediate output are limited so shell work
cannot become an unbounded server load path. This is a sandbox implementation
and never invokes host Bash.

Linux-facing output follows the CS-Linux contract: LF line endings, Linux-style
`uname`, `date`, `uptime`, `ls -la`, `stat`, `df -h`, `du -h`, `free -h`, and
coreutils-like errors and exit status. Dynamic read-only files include
`/proc/cpuinfo`, `/proc/meminfo`, `/proc/version`, `/proc/uptime`,
`/proc/loadavg`, `/proc/mounts`, `/proc/devices`, `/proc/services`, and live
`/proc/<pid>/{cmdline,stat,status}` plus `/proc/self/*`. The runnable/active
counts and last PID in `loadavg` come from the same process table. `dmesg`,
`/var/log/messages`, and `/var/log/auth.log` read actual bounded boot, system,
process, shutdown, and authentication journal entries; the default journal is
limited to 256 records, 32 KiB total, and 1 KiB per record. These are guest
records, not host logs. Recursive or materializing operations remain bounded;
indexed directory and hard-link accounting keeps ordinary listings O(N), while
`diff`, hashes, dumps, `xargs`, and `yes` have explicit input or output
ceilings.

`vi [path]` uses Normal, Insert, and Command modes. Bare `vi` opens a real
`[No Name]` buffer; `:w path` or `:wq path` assigns its first file name, while
`:w` without a name fails explicitly. Backspace on an empty `:` line returns to
Normal mode. Bounded controls include `I`/`A`, `o`/`O`, `gg`/`G`, page movement,
`dd`, `x`, undo, `:w`, `:q`, `:wq`, `:wq!`, `:q!`, Shift+ZZ, and `ZQ`. Python,
shell, JSON/TOML tokens are highlighted, and indentation rainbow backgrounds are
on by default. The native terminal remains 51x19; each Web writer session
normalizes the guest text mode to 80x25 once, then scales the same fixed grid to
the available browser viewport without changing the Computer's cell geometry.
The browser subtracts terminal padding and fits both rows and columns, so the
terminal surface does not expose an internal scrollbar. The browser coalesces up
to 16 keys per relay, while the BDS boundary rejects batches above 32 keys. Tab
performs bounded command/path completion through the same writer-authorized
relay.

The Web Terminal top bar places **PWR**, **HDD**, and **FDD** indicators plus an
explicit writer-only **Power** button immediately after **Copy** and before
**Manual**. The indicators follow the real lifecycle and block-device state; FDD
reports absent media only while no Floppy Disk item is loaded. FDD insert,
eject, motor start, seek, read, and write sounds are synthesized locally with
Web Audio after a browser gesture; no Resource Pack sound file is required.
Events use a per-Computer monotonic sequence, a 32-event ring, and an eight-per-
second ceiling. Reconnect does not replay retained sounds, both writers and
viewers can hear live activity, and leaving range or closing the session stops
active voices. **Copy** copies an active terminal selection, or the visible
fixed-cell screen when nothing is selected. It uses the Clipboard API when
available and a synchronous browser copy fallback for LAN HTTP deployments; no
polling or background clipboard work is performed.

Computer snapshots remain canonical in Bedrock World Dynamic Properties, which
BDS stores in the world's LevelDB. Clean persistence checks compare O(1)
component revisions instead of serializing the whole snapshot. Filesystem child
lookups use a parent index, capacity is cached, and path entries refer to inodes
and shared content-addressed blobs. Versioned OS images are immutable shared
bases; each Computer persists only copy-on-write overlays and deletion
tombstones. Transaction pages are content-addressed, reuse unchanged pages, and
keep only the current and previous complete generations. SQLite is intentionally
not the BDS source of truth because Bedrock Script API cannot access it
directly; a future non-Bedrock host can add a SQLite repository behind the same
boundary. Portable, Desktop, and Advanced Desktop profiles expose 20 MiB, 40
MiB, and 80 MiB fixed IDE disks respectively. A fresh CS-Linux image consumes
roughly 2–4 MiB and a fresh CS-DOS image roughly 0.5–1 MiB. OS utilities are
real executable files, so deleting `/usr/bin/ls` or `C:\COMMAND\EDIT.COM`
removes that command until the file is restored. Guest shell I/O waits for
deterministic controller, seek, rotation, transfer, and settle completion;
WorkMonitor accounts the bounded host completion in its separate `block_io`
lane. `quota` reports the enforced capacity, per-file, and entry limits; `du`
computes bounded subtree usage from one filesystem snapshot. `date` defaults to
wall UTC, with `date --game` and `date --virtual` for Minecraft and
deterministic VM time. Both profiles keep four-digit UTC years without a
two-digit-year pivot, represent the 2000 leap day correctly, and support
timestamps beyond the signed 32-bit 2038 boundary.

The Computer snapshot also carries versioned cold OS-runtime state. Linux keeps
bounded journals, last-login records, service and mount definitions, and offline
device identities, but never revives stale live processes, jobs, sessions,
mounted instances, PID cursors, or job cursors after restore. Older snapshots
without this field receive an empty cold state. DOS similarly persists C: drive
state and FAT metadata while forcing transient A: media absent on cold restore.
An unused network omits its optional key for canonical legacy compatibility. If
a future adapter has registered network definitions, cold restore retains its
interfaces and addresses but forces links down, zeroes counters, and clears all
process-owned sockets/listeners. All projections are validated and idempotent
during preserved-world migration.

Preserved worlds are upgraded automatically at startup. The loader validates the
current generation first and tries the immediately previous complete generation
only when the current one is incomplete or corrupt; this rule applies to both
legacy schema-1 indexed pages and schema-2 content-addressed pages. When the
identity registry is still stored in the legacy page format, startup migrates
and verifies every referenced Computer first, including schema-1
Computer/filesystem payloads, then commits the identity registry last as the
activation point. The migration advances by at most one Dynamic Property
read/write/delete per host tick, and normal Computer, Portable, Monitor, and Web
Terminal startup remains gated until it reaches an explicit `complete` state.
`CS_STORAGE_MIGRATION` log records expose progress or the terminal failure.
Fallback is recovery input, not a terminal migration result: a valid previous
current-format Computer or identity generation repairs and verifies the invalid
head before adapters activate. A valid canonical head is retained when its
previous manifest is corrupt; recovery repairs a representable fallback or
removes the invalid metadata explicitly. Recovery also performs an incremental,
bounded sweep of target-only content blobs, legacy indexed pages, and stray
manifests that interrupted or corrupt metadata can no longer name. Whole-prefix
enumeration is restricted to that recovery path: ordinary periodic saves do not
scan every stored blob, page, or manifest. Page-count and manifest-size limits
are checked before a generation mutates storage, so the writer cannot commit a
generation that its reader or a Dynamic Property cannot accept.

Restarting an interrupted upgrade is idempotent: the legacy identity head still
selects the old world view, while any already verified Computer generation is
recognized and skipped during the rescan. Unsupported or corrupt data fails
without activating a partial identity registry. Before deploying a build that
will upgrade a preserved world, stop BDS completely and copy the entire world
directory, including its LevelDB, to a backup location. Never copy or edit the
LevelDB while BDS is running.

Each Computer also has a persisted virtual hardware profile. Desktop Computer
Systems default to a Computer System 486DX at 33 MHz with 2 MiB RAM. Advanced
Desktop Computer Systems use a Computer System 486DX2 at 66 MHz with 8 MiB RAM.
Portable Computer Systems default to DOS on a Computer System 386SX at 16 MHz
with 2 MiB RAM. Their versioned display profiles share an 80x25 VGA text mode,
320x200 with 256 colors, and a maximum 640x480 guest resolution. Portable uses
256 KiB VRAM and reaches 640x480 with 16 planar colors; Desktop and Advanced
Desktop use 512 KiB VRAM and also expose 640x480 with 256 indexed colors. The
Portable's physical 800x480 LCD centers the 640x480 guest image with 80-pixel
side bars by default; 800x480 is not a guest video mode. At 20 server ticks per
second those profiles receive at most 1,650,000, 3,300,000, and 800,000 modeled
CPU cycles per tick respectively, while the scheduler retains the same global
cap and round-robin fairness across Computers. The 386SX profile uses Intel
80386-derived instruction clocks, value-dependent early-out multiplication,
taken/not-taken branch costs, and explicit penalties for four-byte RAM and stack
transfers over its 16-bit data bus. Timing dispatch remains O(1) per
instruction.

Power-on now exposes an original 80x25 **CSBIOS System Configuration** POST
frame before the first runtime step hands the display to the selected OS. POST
values come from the actual CPU, clock, RAM, display, VRAM, and disk-quota
profiles. CS-DOS enters at a minimal `C:\>` prompt; CS-Linux prints only its OS
identity, a blank separator, and the password or shell prompt. Neither profile
advertises a simulated `tty1` or shell-version banner. VRAM is allocated lazily
at POST and released at power-off. Only the compact display-profile identifier
is persisted in World Dynamic Properties: framebuffer bytes and dirty queues are
volatile and never become high-frequency LevelDB writes. Graphics writes use a
fixed-capacity dirty-tile ring with O(1) marking and bounded O(D) drains. A
Computer-scoped delta broker owns that destructive drain exactly once and fans
the immutable state, keyframe, or delta update out to every attached consumer.
Late consumers queue a complete second keyframe; mode and display replacement
advance a stream epoch; final detach releases all broker state. Computers,
tiles, and payload bytes are independently capped per pass, keeping work at
O(D+S) for emitted dirty tiles and subscribed sessions. Web Canvas delivery and
guest graphics APIs are the next staged increment; the current Web Terminal
continues to present the text terminal.

The shared CS process also models a deterministic, fixed-capacity memory
hierarchy. CS386SX has no on-chip cache: its 16-bit external bus performs two
transfers for an even-addressed 32-bit operand and three for an odd-addressed
operand. Its default 2 MiB memory is identified as two 1 MiB 30-pin SIMM DRAM
modules. CS486DX and CS486DX2 use a cold 8 KiB, four-way unified L1 with 16-byte
lines and write-through stores. Advanced CS486DX2 adds a modeled 256 KiB
external L2 and identifies two 4 MiB 72-pin SIMMs; standard CS486DX identifies
four 512 KiB 30-pin SIMMs and no L2. Cache contents and counters are transient
per process and never enter persistence. Access, replacement, alignment, and
timing selection remain O(1).

Neither model claims dynamic branch prediction. CS486 control flow uses a
simplified five-stage refill penalty, while CS386SX preserves its prefetch
overlap and distinct taken/not-taken costs. `run --stats` reports L1/L2 hits and
misses, bus transfers, unaligned dwords, and pipeline flushes in addition to
instructions, CPU cycles, and virtual time. Thus alignment, cache-line locality,
loop layout, and branch reduction produce observable deterministic results.

On CS486DX and CS486DX2 desktop machines, Computer System Python compiles
branches, calls, returns, and waits to the same validated process representation
and uses bounded `python` syscalls for managed values and native modules. The
selected CPU model owns instruction timing; collection and call costs still
scale with their input size. Native shell commands and Bash scripts currently
use the separate shell interpreter but return bounded CPU-cycle charges, so they
cannot bypass the same budget. Former 20 kHz snapshots migrate to the standard
desktop default when restored. An Advanced Computer record still using a known
standard desktop default migrates once to the CS486DX2 profile. A legacy-default
portable record migrates once at the portable item boundary; any customized OS,
CPU, clock, or RAM configuration remains authoritative. Standard and portable
machines install 2 MiB RAM; the Advanced Desktop installs 8 MiB. Aggregate
runtime data raises `MemoryError` on overflow, while unreachable values are
reclaimed during pressure checks. Linux exposes its 32-bit protected flat
sandbox through `cpuinfo`, `free`, `/proc/cpuinfo`, and `/proc/meminfo`; paging,
swap, virtual-memory paging, and MMU page emulation are not claimed. Linux
memory usage includes a bounded resident kernel, system-service, and buffer
allowance in addition to dynamic guest-runtime bytes. DOS exposes `CPU`, `MEM`,
`MEM /C`, `MEM /D`, and `SYSTEMINFO`. Its 2 MiB view accounts for 640 KiB
conventional memory, bounded UMB/reserved regions, and XMS/HMA state configured
by the modeled `HIMEM.SYS`, `EMM386.EXE NOEMS`, and `DOS=HIGH,UMB` directives.
`MEM` and `MEM /C` separate DOS system/driver residency from guest runtime use
while keeping the region totals internally consistent. This is protected
sandbox/v86 compatibility metadata, not native BIOS/DOS interrupt or `.COM` /
`.EXE` emulation. RAM, persistent disk quota, collection size, and output bounds
are independent limits.

The sandboxed CS486 toolchain adds real 32-bit `EAX` through `EBP` registers,
checked little-endian linear memory, stack/call control flow, terminal CPU
faults, and model-specific instruction cycle costs. The stack starts at the top
of process RAM and grows downward; PUSH/CALL and POP/RET may not cross the
aligned static-data/BSS floor. ESP remains a general register, so these are RAM
boundary checks rather than PUSH-word provenance tracking; RET separately
validates its popped target against real instruction addresses, so one-past-end
is valid only for sequential fallthrough and never as a return target. `as`,
`cc`, and `c++` compile safe initial language subsets to the same versioned,
validated `CS486` executable and accept `-c` to emit a bounded `CS486OBJ`
relocatable object. CS-DOS alone exposes the original, sandboxed `QBASIC.EXE`;
its currently supported integer/console source subset compiles to the same
validated process. Current CS-Linux exposes neither `basic` nor `basicc`.

New ASM objects use `CS486OBJ` v2. A dedicated tokenizer, bounded preprocessor,
parser, constant-expression evaluator, and source-span diagnostics feed `.text`,
`.rodata`, `.data`, and `.bss` sections. Objects carry initialized little-endian
data, alignment, local/global/undefined symbols typed as `function`, `object`,
or `notype`, optional zero-argument function signatures (`()->i32` or
`()->void`), plus structured `text-target`, `data-address`, and `absolute32`
relocations. `ld` resolves Map-backed symbols and applies those records in
O(instructions + initialized bytes + symbols + relocations) work rather than
rewriting assembly text. Readers retain v1 object compatibility. `nm` and
`objdump` inspect both versions and the executable. These files are neither
Linux ELF nor DOS OMF, `.COM`, or `.EXE` files, and no frontend invokes a host
assembler, compiler, linker, or loader.

C and C++ use a dedicated, bounded tokenizer and parser instead of regular-
expression source rewriting. The parser builds a typed AST with lexical scopes
and source spans, requires a function declaration or prototype before each call,
and rejects calling an in-scope local that shadows a function. It then lowers to
CSIR. Computed CSIR values have one SSA definition while mutable C locals remain
explicit `load-local`/`store-local` operations; this is value SSA, not memory
SSA. A bounded verifier checks types, definitions, dominance, control-flow
targets, and explicit terminal states. Deterministic, pass-capped optimization
performs constant folding, copy propagation, unreachable-block cleanup, and
dead-pure-value elimination.

The backend uses bounded deterministic linear-scan register allocation with
checked stack spills and EBP-based stack frames. ESP and EBP are reserved, and
values crossing a call are conservatively spilled under the current ABI. Graph
coloring is neither required nor implemented. C/C++ objects attach the known
zero-argument return signature to both defined and undefined function symbols;
the linker rejects conflicting known signatures while retaining untyped ASM and
v1 compatibility. Integer-return calls use EAX, while known void functions
cannot be exposed through the Python integer-extension ABI. Statement-boundary
`asm("...")` rejects labels, control flow, stack operations, and ESP/EBP access.

CS-Linux exposes the bounded instruction debugger as `csdb`; CS-DOS exposes the
same core as `DEBUG` with DOS command spellings and CRLF output. After loading a
validated CS486 executable, it can pause at an instruction address, set or clear
breakpoints, single-step, continue with a bounded instruction budget, inspect
registers, disassemble, and read memory without modifying it. The hard ceilings
are 256 breakpoints, 100,000 instructions per continue request, 256 instructions
per disassembly request, and 4,096 bytes per memory read. Debug state is owned
by the shell session and is discarded on quit, logout, user switch, or terminal
disconnect. This is not native GDB or DOS DEBUG emulation: source-level debug,
symbolic local-variable reconstruction, memory writes, PIC/IRQ/IDT execution,
and native BIOS/DOS interrupts are not implemented.

Desktop Python resolves same-directory modules followed by `/lib/python` and
`/usr/lib/computer-system/python`. A `.py` module is compiled and initialized
once; a versioned `.o` `CS486OBJ` module exposes only its global `.text`
zero-argument functions as Python attributes and executes them in the same CS486
process with EAX returns. Global data symbols are never callable. For example,
`cc -c fastmath.c -o fastmath.o` beside a script enables `import fastmath`.
Missing, circular, oversized, corrupt, or ABI-incompatible imports fail
explicitly. `run --stats` reports the active CS486DX, CS486DX2, or CS386SX
model, instructions, CPU cycles, and virtual microseconds at its persisted
clock. On CS-DOS, `QBASIC file.bas` opens the IDE and `QBASIC /RUN file.bas`
compiles and runs the supported CS QBASIC subset. No frontend invokes a host
compiler, linker, or native binary. General dynamic/shared libraries remain a
follow-up on the versioned object and ABI foundation. MCP's `cpuCycles` field
uses one unit across ASM, C, C++, CS QBASIC, and desktop Python;
machine-instruction counts remain diagnostic values, not timing units. The
portable CS386SX retains ASM, C, C++, CS QBASIC, and batch support, but rejects
`python`/`micropython` commands with status 127 and does not execute
`/startup.py`.

The native Python `shell` module is not a user API. It is enabled only for the
built-in shell program selected when `/startup.py` is empty. User-authored
`/startup.py`, foreground `python`/`micropython`, and MCP Python cannot import
it; each attempt fails explicitly instead of exposing a live terminal shell
object across an authentication boundary.

The Bedrock pack includes placeable `Computer`, `Advanced Computer`, and
`Monitor` items (`computer_system:computer_item`,
`computer_system:advanced_computer_item`, and `computer_system:monitor`). Their
inventory icons are generated from the authored machine plates. The Portable
Computer System uses the matching authored plate as its held-item icon and can
transfer that identity into the placeable
`computer_system:portable_computer_block`; breaking it returns the same identity
to an item. Placed blocks use internal `computer_system:computer_00..63` or
`computer_system:advanced_computer_00..63` identifiers for their six-face
redstone-output mask. Desktop Web Terminal access requires exactly one
physically adjacent `computer_system:monitor`; missing or ambiguous connections
fail explicitly. The current display block is named Monitor rather than Display.
`computer_system:portable_computer` is the portable DOS item and applies the
CS386SX 16 MHz / 2 MiB profile when its persistent identity is created or a
legacy-default portable identity is safely migrated.

`computer_system:floppy_disk` is a non-stackable 1.44 MiB removable medium. Use
it on a Computer to insert it. On a non-crashed Computer, sneak with an empty
hand to eject; a guest `EJECT`/`eject` command and breaking the machine also
return or drop the item. On a crashed Computer, sneak remains exclusively the
one-shot safe-boot gesture. Media identity and generation survive inventory and
drop round trips; duplicated/stale identities and a second insertion of one
loaded identity are rejected. At most 256 media records are cataloged per world.
Linux uses the root-only commands below; its vfat projection fixes UID/GID 1000,
files at 0644, and directories at 0755, while `chmod`, `chown`, and links fail
explicitly:

```sh
sudo mkfs.fat -F 12 -n SHARED /dev/fd0
sudo mount -t vfat /dev/fd0 /mnt/floppy
cp README.TXT /mnt/floppy/
sudo umount /mnt/floppy
sudo eject /dev/fd0
```

Every placed Computer exposes six machine-relative local-I/O faces in the stable
order `bottom`, `right`, `front`, `back`, `top`, `left`. The chassis cardinal
direction rotates front/right/back/left while top and bottom stay vertical.
Directly adjacent Computers receive one full-duplex RS-232C link per touching
face at 9600 baud, 8N1. Linux names the ports `/dev/ttyS0` through `/dev/ttyS5`;
DOS names the same faces `COM1` through `COM6`. Each direction is limited to 48
bytes per 20 Hz tick with 4 KiB RX/TX queues, atomic writes up to 1 KiB,
backpressure instead of silent loss, and explicit disconnect/power errors. Links
and buffered bytes are transient and are cleared on topology or power-epoch
changes rather than being serialized into World Dynamic Properties.

The same face numbering reserves Linux `/dev/spidev0.0` through `/dev/spidev5.0`
and `/dev/i2c-0` through `/dev/i2c-5`; DOS exposes `SPI1` through `SPI6` and
`I2C1` through `I2C6`. `spi` uses mode 0, 1 MHz, 8-bit, MSB-first atomic
transfers up to 256 bytes. `i2c` uses a 100 kHz 7-bit segment with bounded scan
and combined write/read transactions up to 256 bytes. The controller, conflict,
NACK, and capability contracts are implemented now for future IoT block
adapters; no production sensor block is implied by this foundation.

The Web Terminal transport is a host companion and is not a guest network
interface. The bounded network state above is only the future Issue #6 adapter
boundary: it does not register a default `lo` or `eth0`, route packets, make a
host or guest connection, or fabricate routes or DNS. CS-Linux does not
currently ship IP addressing, `ip`, `ping`, `ss`, package management, or
Internet access. The registered `/dev/fd0` now reflects the removable Floppy
Disk item and its FAT12 volume; the modeled VGA framebuffer still has no
production Web Canvas or guest graphics API. Unsupported boundaries fail
explicitly rather than pretending that host facilities exist inside the guest
OS.

Examples:

```sh
ls -la /
printf 'alpha\nbeta\nalpha\n' | grep alpha | wc -l
echo 'hello world' > message.txt
cat message.txt | tr a-z A-Z
false || echo recovered
i2c 0 scan
spi 0 0 9f0000
bash -c "find / -name '*.py' | sort"
```

This is an intentionally sandboxed compatibility shell, not a host process
launcher. Unsupported applets return a normal `command not found` status rather
than escaping into PowerShell, `cmd.exe`, or the BDS host.

## Repository layout

- `src/domain/`: Minecraft-independent language, VM, filesystem, terminal, and
  device rules
- `src/application/`: lifecycle, OS, runtime, and service orchestration
- `src/bedrock/`: Minecraft Script API adapters and terminal coordination
- `packs/`: Behavior Pack and Resource Pack source assets
- `tools/`: build, deploy, BDS, probe, and MCP tooling
- `tests/`: host, pack, Bedrock adapter, and tool tests
- `docs/`: roadmap, development notes, evidence, and verification checklists

## Planned platform

- Minecraft Bedrock Edition
- Behavior Pack and Resource Pack
- TypeScript compiled to the Bedrock Script API runtime
- A deterministic, instruction-budgeted Python virtual machine
- Vitest-based host-side unit and compatibility tests

## License

No license has been selected yet. All rights are reserved until a license is
added.
