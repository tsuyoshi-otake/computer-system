# Computer System

Computer System is a ComputerCraft-inspired programmable computer add-on for
Minecraft Bedrock Edition.

The project aims to reproduce the ComputerCraft experience as closely as the
Bedrock Add-On and Script APIs allow. Desktop programs can use a sandboxed,
bounded language called Computer System Python. Computer System Python 1.0 is
targeting Python 3.14 syntax and core semantics under the Python 3.14 CS
Profile; the current implementation remains a partial subset. The portable DOS
profile instead supports CS ASM 1.0, CS C/C++ 1.0, CS QBASIC 1.0, and bounded
batch programs. The computer lifecycle, terminal, filesystem, events,
networking, peripherals, portable computers, and turtles follow
ComputerCraft-style behavior.

The implemented desktop subset includes bounded Python 3-style structural
pattern matching with soft-keyword `match`/`case`, guards, atomic captures,
OR/AS, sequence, mapping, and C3 multiple-inheritance class patterns. The exact
surface and deliberate exclusions are recorded in
[`docs/python-compatibility.md`](docs/python-compatibility.md).

Classes now include bounded inherited descriptors with Python's data/instance/
non-data precedence, ordered atomic `__set_name__`, `property`, `staticmethod`,
`classmethod`, bound-method `__self__`/`__func__` reflection, data-descriptor
and property deletion, inherited `__getattribute__`/`__getattr__`/
`__setattr__`/`__delattr__`, and the `getattr`/`setattr`/`delattr` built-ins.
`del` covers bounded names, attributes, list/dictionary items, list slices, and
nested target lists. Multiple bases use one bounded C3 MRO shared by descriptor,
hook, special-method, pattern, and subclass lookup; classes expose stable
`__base__`, `__bases__`, and `__mro__` reflection. These calls remain on the
single CS486 process and share its call-depth, managed-heap, exception,
rollback, and instruction-slice limits.

It also includes Python 3.14-style deferred annotations for simple module and
class variables plus function parameters and returns. Successful
`__annotations__` access caches a mutable dictionary; failed access retries,
function-local annotations remain unevaluated, and partially initialized modules
expose only entries executed so far without caching.

Generic functions, classes, and `type` aliases accept bounded Python 3.14 type
parameter lists. `TypeVar`, `TypeVarTuple`, and `ParamSpec`-shaped runtime
objects are exposed through stable `__type_params__` tuples; bounds,
constraints, defaults, and alias `__value__` evaluate lazily, cache only
success, and retry after faults. Generic classes and aliases support bounded
subscription such as `Box[int]`; `list`, `dict`, `tuple`, and `set` expose the
same type-erased subscription surface with stable `__origin__`, `__args__`, and
`__parameters__`. The broader `typing`/`annotationlib` library contract, runtime
type enforcement, `pip`, and `venv` are not implied.

The runtime also owns a bounded intrinsic `typing` core that guest files cannot
shadow. It provides the documented Python 3.14 special types/forms, runtime type
parameter constructors, `get_origin`/`get_args`, and identity-only helper calls
without invoking host Python or enforcing annotations at runtime.

<table>
  <tr>
    <td align="center"><img src="web/assets/manual/desktop-computer-system.png" alt="Computer System Deskpro 486 family sheet showing its all-in-one CRT chassis, keyboard, mouse, and 3.5-inch floppy drives" height="400"></td>
    <td align="center"><img src="web/assets/manual/portable-computer-system.png" alt="Computer System LTE 386SX sheet showing its DOS terminal, keyboard, trackball, 3.5-inch floppy drive, ports, battery, and 2 MiB RAM specification" height="400"></td>
  </tr>
  <tr>
    <td align="center"><b>Computer System Deskpro 486 family</b><br>486DX/33 and 486DX2/66 CS-Linux profiles</td>
    <td align="center"><b>Computer System LTE 386SX</b><br>386SX 16 MHz / 2 MiB CS-DOS mobile profile</td>
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
adapters, portable computer identity, integrated desktop displays, and bounded
Bedrock probes are covered by host and Bedrock Dedicated Server verification.

The latest public build is
[v0.1.0-alpha.6](https://github.com/tsuyoshi-otake/computer-system/releases/tag/v0.1.0-alpha.6).
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
menus, cursor navigation, insert/overwrite modes, bounded undo and search, F1
help, F2/Ctrl+S save, Ctrl+Shift+S Save As, and an explicit Save/Discard/Cancel
exit state. Menu pointer hits are constrained to the visible menu box. `vi` is
the configurable modal editor for Linux and DOS; Linux deliberately does not
expose `EDIT`. Both editors use the same writer-owned bounded key transport and
render inside the fixed 80x25 Web Terminal hardware text grid.

DOS `EDIT`, CS QBASIC, PWB/CS C/C++, and CSASM share configurable editor
services. Their Options dialogs control syntax colors, line numbers, rainbow
indentation, whitespace markers, wrapping, autoindent, tab expansion and widths,
completion, candidate/definition sources, and language selection. Ctrl+Space
opens at most 64 completion candidates, Ctrl+Shift+O lists document symbols, F12
jumps to a lightweight definition, and Alt+Left returns through at most 16
jumps. Ctrl+N remains File > New. The fixed candidate priority is current-file
words, up to eight recently opened buffer summaries, functions/types/macros/
labels, language keywords, then optional direct includes. Indexes are lazy and
revision-cached; include lookup is non-recursive and opt-in, reads at most eight
guest files and 32 KiB total, and never starts an LSP or host process.

All four products load `C:\EDITOR.INI`, with `[common]`, `[edit]`, `[qbasic]`,
`[pwb]`, and `[csasm]` sections. Options > Save Settings updates only the active
product section while preserving the others; Reload Settings and Restore
Defaults are explicit. The file is capped at 4,096 characters and 64 lines, and
invalid input rejects editor startup atomically. Syntax and completion start on;
line numbers, rainbow indentation, whitespace markers, and wrapping start off.
Source IDEs enable autoindent and default to four expanded columns. Plain EDIT
does not enable autoindent and uses the MS-DOS-style eight-column tab default.
`EDIT` auto-detects Text, BASIC, C, C++, ASM, and Python; Python editing does
not imply Python execution support on CS-DOS.

Each IDE's Run menu provides DOS Command, Repeat DOS Command, and Insert Command
Output. They use only the sandboxed guest shell, insert at most 128 lines or
4,096 characters as one undoable operation, reject background/asynchronous/TUI/
session-control work, and restore the parent guest directory, environment,
aliases, functions, umask, exit status, and outer editor ownership before
editing resumes. Plain EDIT keeps the MS-DOS File menu shape instead: New, Open,
Save, Save As, Print, and Exit with the two canonical separators. Print remains
visible for layout compatibility but fails explicitly because CS-DOS has no
guest printer device.

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
[the feasibility matrix](docs/feasibility-matrix.md). The optional Issue #106
wasm batch-executor prototype and its adoption-gate evidence are recorded in
[the Issue #106 evidence document](docs/issues/issue-106-wasm-batch-executor.md).
Player-experience checks are intentionally isolated in the
[manual verification checklist](docs/manual-verification.md).

## Requirements

- Node.js 24 or later
- Minecraft Bedrock Edition 1.26.30 or later in the 1.26 release line
- The official Bedrock Dedicated Server distribution for BDS verification

The current package baseline uses `@minecraft/server` 2.8.0,
`@minecraft/server-ui` 2.1.0, and `@minecraft/vanilla-data` 1.26.33.

## Install the alpha preview

1. Download
   [`computer-system-0.1.0-alpha.6.mcaddon`](https://github.com/tsuyoshi-otake/computer-system/releases/download/v0.1.0-alpha.6/computer-system-0.1.0-alpha.6.mcaddon).
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
administration commands. `bds_list_computers` reads bounded pages of exact
currently placed Computer identities without powering them on.
`bds_open_web_terminal` uses a server-authorized headless MCP debug principal to
activate one selected exact Computer ID, opens the one-use path in the companion
host's default browser, and verifies that exact writer connection without a
connected Bedrock player or an exposed URL in its MCP result.
`bds_get_tui_screen` reads that exact debug-owned writer's current authoritative
text surface; `bds_verify_tui_screen` returns a bounded pass/fail report for
geometry, cursor, color grids, literal presence/absence/order, same-row groups,
and continuous vertical character runs without returning the screen text;
`bds_send_tui_input` relays one bounded line, up to 32 keys, or an interrupt;
and `bds_wait_for_tui_screen` waits event-first for a literal screen match or
later snapshot version. The screen result preserves row-ending spaces, geometry,
cursor, and optionally the exact 0-15 foreground/background grids, while
excluding bearer tokens, one-use URLs, connection codes, player IDs, audio, and
storage details. Both companion and Bedrock reject MCP input and inspection
while a secret prompt is active. The versioned `surface.kind: "text"` contract
leaves pixel/tile surfaces additive for a future CS Windows-style UI; it does
not claim to verify browser CSS, VGA font pixels, or scaling.
`bds_issue_web_handoff` returns the one-use URL only when the caller explicitly
needs to own it. `bds_wait_for_web_handoff` remains available when an operator
will trigger the interaction separately. Both paths prevent browser auto-open
from consuming the claimed URL first and bound input, concurrency, output, and
waits. The MCP direct `python <file>`, `micropython <file>`, and bounded
multiline `python -c <source>` forms run through the target Computer's Computer
System Python compiler, filesystem, hardware profile, and RAM limit. Only the
inline Python debug form may contain encoded line breaks; ordinary debug
commands remain one line. The normal CS-Linux shell also accepts
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

Browser auto-open defaults to enabled, and the companion automatically opens
each eligible one-use handoff only when the effective published host—detected
automatically or overridden by `WEB_COMPANION_PUBLIC_HOST`—is a literal IP
address assigned to the companion host and no custom public origin is
configured. A service published as `10.255.10.90` therefore opens the same path
through `127.0.0.1` in the server host's default browser. Set the flag to `0` to
disable host-browser opening or to `1` to request it explicitly while retaining
the locally reachable-listener check. This is a server-address check, not a
Minecraft player-IP check: an eligible remote player interaction may open the
browser on the server host, never on the remote player's device.

Interacting with a Desktop or Advanced Desktop Computer System activates browser
access directly through its built-in CRT. The Portable Computer System likewise
uses its built-in display and opens the link while held or placed. The companion
advertises a stable LAN entry page and Minecraft prints the Computer's permanent
four-digit number. Touching the machine activates that number once for two
minutes. The companion waits for Bedrock to accept the exact session before it
opens a browser or exposes the handoff; a rejection or timeout closes that exact
session instead of leaving an orphan. Invalid codes are rate-limited per client,
and a simultaneous four-digit collision fails explicitly rather than connecting
the wrong Computer. A `GET /p/NNNN` only redirects to the stable entry page and
never consumes or exposes authentication state. The page exchanges the
activation with one same-origin `POST /api/handoff`, then takes the writer
lease. The browser-only bearer token is never written to BDS logs, a query, or
browser history. The authenticated session lasts at most 30 minutes. Placed
machines pause only after the requesting player moves beyond three blocks, and
resume at 2.75 blocks or nearer. The deadband keeps the current state,
preventing boundary jitter from alternating `out_of_range` and `in_range`. Range
state appears in the Web UI; Minecraft chat is not used for steady
range-transition notices. After the first successful connection the browser
stores only the permanent four-digit number in local storage and changes the
bookmarkable URL to `/?computer=NNNN`. Opening that bookmark rotates the bearer
token through one deduplicated, bounded exponential-backoff loop. The loop stops
on terminal authentication outcomes, caps attempts, and honors `Retry-After` for
rate limits. Code and exact-session lookups are O(1). A held Portable is the
access point itself and does not use the placed-block distance check.

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
`LABEL`, and read-only `CHKDSK`. Computer System DOS 1.0 (`CS-DOS 1.0`) reads a
bounded `CONFIG.SYS` and runs `AUTOEXEC.BAT`; `SET`, `PATH`, `PROMPT`, `REM`,
`@ECHO OFF`, `%0`…`%9`, `%VAR%`, and `%ERRORLEVEL%` are supported. Unsupported
boot directives are parsed and resolved as one atomic plan. Any invalid line or
driver rejects the whole plan, emits bounded diagnostics, and boots the explicit
64 KiB degraded-low profile before AUTOEXEC continues; no earlier line is
partially retained. `DEVICE`/`DEVICEHIGH` enables the modeled HIMEM or EMM386
state only after the referenced installed guest file begins with the expected
versioned CS-DOS driver capsule. A missing, deleted, or corrupt file fails
before changing memory state. `DEVICEHIGH` tries one contiguous UMB block and
reports when it falls back to conventional memory.

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
FAT timestamp. Normal `DIR` splits a strict 8.3 name into eight-character base
and three-character extension columns, aligns `<DIR>` or a comma-grouped size,
and uses `MM-DD-YY` plus a space-padded 12-hour `a`/`p` time. Its totals and
free bytes are also locale-independent comma-grouped values; `/B` and `/W`
retain their separate formats. `DIR /A` filters read-only, hidden, system,
directory, and archive state. `ATTRIB` displays or changes R/H/S/A (including
bounded `/S`), and read-only state is enforced by write, delete, rename, copy,
and editor paths. `LABEL` reads or changes the generation-bound volume label.
`CHKDSK` reports actual file/directory/byte/free counts and metadata consistency
but never repairs the volume. It does not alter guest file contents, labels, or
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
text:   echo printf head tail wc grep sed awk sort uniq tr cut seq tee cmp diff xargs
archive: tar gzip gunzip zip unzip
inspect: file sha256sum od hexdump df du quota mount dmesg
shell:  sh bash source env printenv export unset alias unalias command read
identity: whoami id groups passwd su sudo login logout getent
accounts: useradd userdel usermod groupadd groupdel
process: ps top kill jobs fg bg wait nice nohup watch tty who w last service
manual: man apropos
info:   hostname uname date uptime cpuinfo free
system: clear vi history time sleep crontab test [ umask sync shutdown reboot exit true false
DOS:    EDIT DIR ATTRIB LABEL CHKDSK TREE VOL TIME TIMER DOSKEY MEM DEBUG + aliases
toolchain: as cc c++ ld make nm run objdump csdb (make is Linux-only; QBASIC and DEBUG on DOS)
version control: git (bounded local CS System Git repositories; Linux only)
```

CS-Linux provides a deliberately bounded implementation of the added Unix
utilities. `crontab -l` reads the single system `/etc/crontab`, while root
`crontab -e` edits that same file with the existing `vi`; no per-user spool is
created, and cron reloads the file on service start or restart. `sed` and `awk`
use a guest-owned pattern/parser subset with explicit program, rule, input, and
record ceilings. `tar`, `gzip`, and `zip` use byte-preserving filesystem I/O;
archive extraction is preflighted and transactional. Gzip emits and accepts
stored-DEFLATE streams, and ZIP accepts unencrypted method-0 archives;
unsupported compression, ZIP64, traversal, and symlink pivots fail explicitly.

`nice` changes the bounded scheduler slice and exposes NI through `ps` and
`top`. `nohup` applies only to supported background `sleep`, Python, or linked
`run` work ending in `&`, reparents it to PID 1, and ignores terminal SIGHUP
without bypassing shutdown finalization. `watch` remains finite: it has a
bounded interval, a default count of 300, and an upper count of 3,600.

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

`vi [path]` uses Normal, Insert, and Command modes. Its content begins on the
first row, with a cell-wide block cursor and no persistent Normal-mode banner.
The reverse-video penultimate row owns the file name, dirty marker, cursor
position, and viewport position; the final row is reserved for `:` input,
messages, and `-- INSERT --`. `[+]` appears only after a change and clears after
a successful save. Bare `vi` opens a real `[No Name]` buffer; `:w path` or
`:wq path` assigns its first file name, while `:w` without a name fails
explicitly. Backspace on an empty `:` line returns to Normal mode. Bounded
controls include `I`/`A`, `o`/`O`, `gg`/`G`, page movement, `dd`, `x`, undo,
`>>`/`<<`, `:w`, `:q`, `:wq`, `:wq!`, `:q!`, Shift+ZZ, and `ZQ`.

Insert-mode completion is enabled by default. `Ctrl+N` and `Ctrl+P` cycle a
bounded candidate list and `Ctrl+E` restores the text from before completion;
Tab remains indentation. Candidates have a fixed priority: words in the current
file, words in the eight most recently visited buffers, indexed
functions/types/macros/ASM labels, language keywords, and optional direct
include files. `gd` jumps to the definition under the cursor, `Ctrl+O` returns,
and `:symbols` shows the current lightweight index. Moving to another file is
blocked while the current buffer has unsaved changes.

Syntax colors, line numbers, indentation rainbow backgrounds, automatic
indentation, whitespace markers, and line wrapping start disabled. Enable them
with `:syntax on` and `:set number rainbow autoindent list wrap`; disable them
with `:syntax off` and the matching `:set no...` names. `expandtab` starts
enabled with `tabstop=2` and `shiftwidth=2`; `:set noexpandtab`, `tabstop=N`,
and `shiftwidth=N` accept values from 1 through 16. `:set`, `:set all`, and
`:set option?` report the complete current state. Linux loads `~/.vimrc`; DOS
loads `C:\_VIMRC`. Configuration is capped at 4,096 characters and 32 lines, and
an invalid line rejects the open without partially applying earlier lines.
Completion uses `complete`, `completecase=smart`, `completeprefix=2`, and
`completesources=current,buffers,symbols,keywords` by default. Select
`completecase=sensitive|insensitive`, disable it with `nocomplete`, or opt into
direct guest-file candidates with `completesources=...,includes`. Definition
lookup defaults to `definitionsources=current,buffers`; append `includes` to
search direct includes. `filetype=auto` (alias `ft`) detects
`python|basic|c|cpp|asm|shell|json|text` and may be overridden explicitly.
Include lookup is non-recursive and capped at eight readable guest files and 32
KiB total; it never reads host files or starts an LSP. The on-demand
current-file index scans at most 256 KiB or 16,384 lines and retains at most
2,048 word occurrences and 512 symbols.

`:!command` runs a bounded command through the same guest shell, `:!!` repeats
it, and `:r !command` inserts at most 128 lines or 4,096 characters of stdout
below the current line as one undoable edit. These commands never reach a host
shell. Background, asynchronous, session-control, foreground-process, and TUI
commands fail explicitly; the parent shell directory, environment, aliases,
functions, umask, and exit status are restored before `vi` resumes. The native
terminal remains 51x19; each Web writer session normalizes the guest text mode
to 80x25 once, then scales the same fixed grid to the available browser viewport
without changing the Computer's cell geometry. The browser subtracts terminal
padding and fits both rows and columns, so the terminal surface does not expose
an internal browser scrollbar. Guest-rendered EDIT, vi, and WorkBench scrollbars
remain cells in that same snapshot and are not removed by the centered wrapper.
The complete fixed-cell display surface stays centered on both axes in CLI and
TUI states without a simulated monitor bezel. One blank raster row above and
below the fixed 80x25 grid preserves the vertical blanking margin of a CRT
without changing guest coordinates. The display uses the IBM VGA 9x16 fixed-cell
font, unit line spacing, and default light gray `#a8a8a8`. The 80x25 text and
full-screen TUI paths share one 720x400 logical glyph raster. Including the two
blanking rows, a 0.8 horizontal correction presents the complete CRT glass at
exact 4:3 without changing guest cells or pointer coordinates. Raster correction
is mode-specific: future 640x480 VGA uses 1.0, while 320x200 uses its own
correction. This does not claim CS Windows support; it keeps a future 640x480
graphics surface from inheriting the text-mode correction. Its active-page
**Options** dialog selects **Off**, **Subtle**, **Arcade**, or **Shadow Mask**
CRT profiles independently from **Flat** or **Curved Glass** shape. A new page
starts at Subtle and Flat; the bounded Curvature slider is enabled only for
Curved Glass, spans 0-30%, and starts at 2%. The selected percentage drives both
the SVG displacement and inverse TUI pointer mapping. These tab-only
presentation settings do not change cells, palettes, copied text, or the bounded
row-diff render path. The browser coalesces up to 16 keys per relay, while the
BDS boundary rejects batches above 32 keys. Tab performs bounded command/path
completion through the same writer-authorized relay. The guest shell owns both
candidate discovery and presentation: a unique match or shared prefix is
inserted without submitting, while unresolved matches are printed in bounded
columns inside the fixed 80x25 terminal before the prompt and unsubmitted draft
are redrawn. At most 64 candidates are considered and an in-terminal `...` marks
truncation; candidate lists never become browser DOM state. CS-DOS uses
case-insensitive matching, uppercase display names, drive prefixes, and
backslashes while CS-Linux retains case-sensitive paths. Input is briefly locked
while a request is pending, and control loss or a stale relay response cannot
apply obsolete text.

Each terminal snapshot carries one versioned interaction descriptor derived from
authoritative guest state. It selects line, bounded key-batch, or disabled
input; cell-pointer admission; secret masking; interrupt availability; and up to
five contextual key hints. The companion and browser validate the same schema,
so guest text such as `-- INSERT --` cannot change input mode. Input is rejected
until the first descriptor arrives. A missing or unsupported schema shows
**RELOAD REQUIRED**, clears stale hints, and asks the operator to restart the
companion and Computer components together before reloading the page; it never
falls back to terminal-text heuristics.

The Web Terminal top bar places equal-size **Options**, **Copy**, and **Manual**
controls first, followed by the **PWR**, **HDD**, and **FDD** indicators plus
explicit writer-only **Eject** and **Power** buttons. The indicators follow the
real lifecycle and block-device state; FDD reports absent media only while no
Floppy Disk item is loaded. Eject returns loaded media to the connected player
and is disabled for viewers, offline sessions, and an empty drive. The footer
exposes tab-local virtual Caps Lock, Num Lock, and Scroll Lock indicator
buttons. Each starts hollow/off and toggles independently to filled/on by
pointer, Enter, or Space. These switches change only their indicators in the
current browser tab: they never change host operating-system locks, terminal
input, guest behavior, or frame rendering, and a reload resets them to off. FDD
insert, eject, motor start, seek, read, and write sounds are synthesized locally
with Web Audio after a browser gesture; no Resource Pack sound file is required.
Events use a per-Computer monotonic sequence, a 32-event ring, and an eight-per-
second ceiling. Reconnect does not replay retained sounds, both writers and
viewers can hear live activity, and leaving range or closing the session stops
active voices. **Copy** copies an active terminal selection, or the visible
fixed-cell screen when nothing is selected. It uses the Clipboard API when
available and a synchronous browser copy fallback for LAN HTTP deployments; no
polling or background clipboard work is performed. Ctrl+C follows that same
selection rule; with no selection it sends an interrupt only when the current
descriptor advertises an interruptible foreground operation. The contextual
footer remains visible on desktop and narrow layouts and changes with shell,
authentication, editor, debugger, and busy state.

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
removes that command until the file is restored.

Portable CS-DOS capacity uses an explicit FAT16-like policy: 2,048-byte data
allocation units, a 59,392-byte fixed metadata/tail reserve for its 20 MiB
layout, a 512-entry root directory, and 32-byte directory entries. File sizes
shown by `DIR` remain logical bytes; free-space accounting rounds each non-empty
file and growing subdirectory to clusters. The supplied 47 MB MS-DOS 6 reference
image also uses 2,048-byte clusters, but remains reference evidence rather than
an imported or byte-for-byte guest image.

Guest shell I/O waits for deterministic controller, seek, rotation, transfer,
and settle completion. Logical transfers larger than 64 KiB are conserved as a
bounded sequential series of at-most-128-sector requests before one command
completion is published; WorkMonitor accounts the bounded host completion in its
separate `block_io` lane. `quota` reports the enforced capacity, per-file, and
entry limits; `du` computes bounded subtree usage from one filesystem snapshot.
`date` defaults to wall UTC, with `date --game` and `date --virtual` for
Minecraft and deterministic VM time. Both profiles keep four-digit UTC years
without a two-digit-year pivot, represent the 2000 leap day correctly, and
support timestamps beyond the signed 32-bit 2038 boundary.

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
read/write/delete per host tick, and normal Computer, Portable, and Web Terminal
startup remains gated until it reaches an explicit `complete` state.
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

Power-on runs an original, deterministic 80x25 **CSBIOS Revision 1.1** sequence.
At 20 server ticks per second its 70 ticks take about 3.5 seconds: black, CS-VGA
identification, a short black transition, CSBIOS and an eight-step same-row
memory count, factual device detection, explicit fixed-disk or floppy source
plus CS-Linux/CS-DOS target, a handoff blackout, and the selected `Starting ...`
line. The Computer remains `booting`; guest CPU work and terminal/debug input
remain unavailable until the final handoff. POST values come only from the
active CPU, clock, RAM, display, VRAM, floppy state, and disk quota. CSBIOS does
not copy AMI vendor strings or advertise an unsupported setup utility or FPU.

At handoff the BIOS frame is cleared once and guest execution starts. CS-DOS
enters at a minimal `C:\>` prompt; CS-Linux prints only its OS identity, a blank
separator, and the password or shell prompt. Neither profile advertises a
simulated `tty1` or shell-version banner. VRAM is allocated lazily at POST and
released at power-off. Only the compact display-profile identifier is persisted
in World Dynamic Properties: framebuffer bytes and dirty queues are volatile and
never become high-frequency LevelDB writes. Graphics writes use a fixed-capacity
dirty-tile ring with O(1) marking and bounded O(D) drains. A Computer-scoped
delta broker owns that destructive drain exactly once and fans the immutable
state, keyframe, or delta update out to every attached consumer. Late consumers
queue a complete second keyframe; mode and display replacement advance a stream
epoch; final detach releases all broker state. Computers, tiles, and payload
bytes are independently capped per pass, keeping work at O(D+S) for emitted
dirty tiles and subscribed sessions. Web Canvas delivery and guest graphics APIs
are the next staged increment; the current Web Terminal continues to present the
text terminal.

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

Production Bedrock admission advances each guest CPU at approximately one
hundredth of its persisted nominal clock. At 20 TPS this admits 8,000 cycles per
tick for CS386SX 16 MHz, 16,500 for CS486DX 33 MHz, and 33,000 for CS486DX2 66
MHz. A 40,000-instruction per-runtime ceiling and 200,000-instruction global
ceiling remain bounded safety limits; under multi-Computer host contention the
observable rate may be lower, never higher.

The authored Behavior Pack setting `packs/behavior/config/computer-system.json`
controls this ratio through `guestRealtimeDivisor` (`1..10000`). `100` means
approximately 1/100 realtime, `1` requests realtime admission, and larger values
are slower. The build rejects unknown fields, unsupported versions, fractions,
and out-of-range values. Rebuild the packs and restart BDS after changing it;
the setting never mutates the persisted guest clock or rewrites guest timing
from host elapsed time.

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
reclaimed during pressure checks. One boot-scoped CS-Linux memory manager owns
every physical lease. It reserves a 384 KiB base kernel plus up to
`min(384 KiB, RAM / 16)`, 192 KiB of services, and reclaimable buffers capped by
`min(256 KiB, RAM / 32)`. Admission may shrink the buffer lease and release
refills it toward the boot target, so `MemAvailable` is real free RAM plus the
currently reclaimable buffer bytes.

Linux exposes its 32-bit protected flat sandbox through `cpuinfo`, `free`,
`/proc/cpuinfo`, and `/proc/meminfo`; paging, swap, virtual-memory paging, and
MMU page emulation are not claimed. `free`, `vmstat`, `/proc/meminfo`,
`/proc/<pid>/status`, and snapshot-only `top` read one immutable
`O(allocations)` manager snapshot. `vmstat` prints one bounded report line in
KiB with runnable/waiting process counts; its swap, io, and system columns are
always zero because no swap device or sampled interrupt counters are modeled,
and interval/count operands are rejected. Declared CS executable linear bytes
become `VmSize`/VIRT and the physical reservation becomes `VmRSS`/RES. Kernel,
services, buffers, and guest runtime reconcile exactly with the shared ledger;
there is no optional callback or synthetic display fallback. A request larger
than `MemAvailable`, or a Linux configuration too small for kernel and services,
fails explicitly without a partial lease.

DOS exposes `CPU`, `MEM`, `MEM /C`, `MEM /D`, `MEM /F`, and `SYSTEMINFO`. One
boot-scoped memory manager owns the address map and the transient RAM ledger.
The 2 MiB portable view contains 640 KiB conventional memory, reserved video at
640–767 KiB, UMBs at 768–895 KiB, reserved ROM at 896–1023 KiB, and XMS above 1
MiB. UMBs exist only with the modeled `HIMEM.SYS`, `EMM386.EXE NOEMS`, and
`DOS=UMB`; HMA is the first 64 KiB of XMS and is never counted as extra
capacity. `DOS=HIGH` moves the complete DOS high set only when it fits, while
`COMMAND.COM` remains conventional.

`MEM` has no independent fallback calculation: all variants read one immutable
manager snapshot. `/C` shows category/module residency and actual placement,
`/D` shows manager flags and boot diagnostics, and `/F` shows real free extents
and largest contiguous blocks. The paragraph-aligned first-fit allocator
coalesces immediately and all snapshot/allocation work is bounded
`O(active allocations + free extents)`.

Editors, IDEs, compilers, linkers, debuggers, boot programs, and foreground or
background processes acquire explicit physical grants before retained state or a
`Cs486Process` is created. Version 3 executables declare the `cs-flat32-v1`
stack, heap, and auxiliary residency; version 1/2 executables remain readable
and take the complete currently free remainder exclusively for compatibility.
The built-in empty-`/startup.py` shell is one 64 KiB composite grant. A
long-lived user-authored `/startup.py` receives auxiliary residency equal to one
quarter of physical RAM, capped at 1 MiB, while foreground Python keeps its
historical 1 MiB managed-runtime quota. This leaves deterministic admission room
for an ordinary foreground process on a 2 MiB desktop. Every completion, close,
cancel, failure, disconnect, detach, and shutdown path has one exactly-once
finalizer, and manager close requires a zero ledger. These values model guest
residency and are not byte-perfect measurements of the JavaScript host heap.
This is a Computer System ABI—not DPMI, EMS page mapping, native BIOS/DOS
interrupts, or native `.COM`/`.EXE` execution. RAM, persistent disk quota,
collection size, and output bounds remain independent limits.

The sandboxed CS486 toolchain adds real 32-bit `EAX` through `EBP` registers,
checked little-endian linear memory, stack/call control flow, terminal CPU
faults, and model-specific instruction cycle costs. The stack starts at the top
of process RAM and grows downward; PUSH/CALL and POP/RET may not cross the
aligned static-data/BSS floor. ESP remains a general register, so these are RAM
boundary checks rather than PUSH-word provenance tracking; RET separately
validates its popped target against real instruction addresses, so one-past-end
is valid only for sequential fallthrough and never as a return target. CS ASM
1.0 (`as`/`ASM`) and CS C/C++ 2.0 (`cc`/`CC` and `c++`/`C++`) compile safe
initial language subsets to the same versioned, validated `CS486` executable and
accept compile-only switches to emit a bounded `CS486OBJ` relocatable object.
CS-DOS alone exposes the original, sandboxed `QBASIC.EXE`; its currently
supported integer/console source subset compiles to the same validated process
as CS QBASIC 1.0. Current CS-Linux exposes neither `basic` nor `basicc`.

CS-Linux also installs the deterministic versioned `CS486AR` static-archive
format, guest `ar`/`ranlib`, the legacy word libraries under `/usr/lib`, and
model-matched `libc.csa`/`libcurses.csa` under `/usr/lib/cs-word32-v1` and
`/usr/lib/cs-byte8-v1`. `cc`, `c++`, and `ld` preserve ordered `-L`/`-l`
operands, select the declared data-model library path, and extract only demanded
archive members through bounded symbol indexes. The compiler driver accepts
C11/C++11, `-O0`/`-O1`, `-g`, `-Wall`, `-Werror`, `-I/-D/-U`, and atomic
`-MMD/-MF` dependency output; other optimization, language-standard, or warning
options fail explicitly. This is not Unix `ar`, ELF, native x86, or dynamic
linking, and no operation invokes a host compiler or filesystem.

Current CS-Linux installs CS Make 1.0 as `/usr/bin/make`. It accepts the
documented `-f`, `-C`, `-n`, `-B`, and `-s` options, command-line variable
overrides, explicit targets, `.PHONY`, the four common assignment forms,
parenthesized and braced variable references, doubled dollar signs, and the
automatic `$@`, `$<`, `$^`, and pattern-stem `$*` variables. Bounded pattern
rules, required or optional Makefile includes, `ifeq`/`ifneq`/`ifdef`/`ifndef`
conditionals, and generated dependency-only rules are supported. Guest mtimes
plus bounded `CSMAKE2` records in `.cs-make-state` skip current targets only
when SHA-256 input, output, recipe, and toolchain identities all still match.
Missing, evicted, legacy `CSMAKE1`, or foreign-toolchain records rebuild
conservatively; malformed state fails explicitly. Makefile parsing, planning,
and fingerprint reads start only after the make PID and 128 KiB RAM lease are
admitted to the guest compile lane. The initial bounded planning step advances
no recipe, then at most one isolated recipe runs per scheduler tick with
credentialed filesystem I/O accounting. Each successful target commits its state
only after recipe I/O and post-build input/output verification complete; a later
target failure keeps earlier committed targets, while state-I/O failure restores
the last committed state. A target's newly generated `.d` prerequisites enter
that first committed fingerprint, so an identical second build is a no-op.
Recipes admit only the documented guest toolchain (including `ar` and `ranlib`)
and bounded filesystem and output utilities. Pipelines, redirects, command
chains, background work, recursive make, arbitrary implicit-rule search,
parallel jobs, and host execution fail explicitly. Makefiles are limited to an
aggregate 32,768 characters, 256 lines, 64 included files at depth 8, 128
rules/patterns, 512 edges, 256 recipes, and graph depth 32; one fingerprint pass
reads at most 16 MiB. CS-DOS does not install `make`; its separate bounded build
contract remains CS PROGRAM LIST/PWB.

Current CS-Linux also installs CS System Git 1.0 as `/usr/bin/git`. It is an
independent, bounded Git-like version-control system with familiar `init`,
`status`, `add`, `rm`, `commit`, `log`, `show`, `diff`, `branch`, `switch`,
`checkout`, `merge`, `tag`, `remote`, and local `config` commands. Repositories
use `.git`, `.gitignore`, `.git/info/exclude`, SHA-256 content addressing,
executable modes, binary blobs, and symbolic-link targets. The required
`computerSystemVcs` format extension, object encoding, and index intentionally
make these repositories incompatible with native Git; hooks, helpers, filters,
submodules, LFS, signing, shallow history, config includes, and host execution
are not implemented. Merge is an exact-path bounded three-way merge with
fast-forward support; it has no rename detection, octopus merge, recursive
multiple-merge-base synthesis, or conflict-marker worktree state. Unsupported
histories and every content/path conflict fail before mutation.

One repository tracks at most 256 paths, scans 512 worktree entries, stores
2,048 objects, walks 256 commits per history request, and caps one object at 384
KiB. Each invocation acquires and releases a 1 MiB guest RAM lease. Bounded
payload, hash, object, and transaction buffers are processed sequentially. Data
I/O uses the credentialed guest filesystem and block-I/O owner, while index,
checkout, merge, commit, and compare-and-swap ref changes are transactional.
Repository ownership, `.git` symlinks, corrupt hashes, unsafe paths, ignore
complexity, output, total bytes, and work units all fail explicitly.

`git remote` may store credential-free `cs+tcp://`, `ssh://`, or `https://`
endpoints. `clone`, `fetch`, `pull`, and `push` currently fail because CS-Linux
1.0 has no authenticated guest TCP/IP transport. The future application port
accepts only an injected guest repository exchange, scoped challenge-response
credential provider, and guest transport. Peer trust precedes credential
acquisition; protocol capabilities, per-tick/total ceilings, backoff delays,
chunked object readers, quarantine verification/promotion, and compare-and-swap
ref updates are explicit. One session releases all readers, credentials,
quarantine, and transport state on every terminal path without reaching host Git
or host networking. An uncertain ref update ends in `unknown` and must be
reconciled before retrying.

On CS-DOS, `CSASM [source]`, `CSCC [source]`, `CSCPP [source]`, and
`PWB [source]` open the full-screen WorkBench. `CSCC` accepts C, `CSCPP` accepts
C++, and `PWB` selects ASM, C, or C++ from the source extension. Its
File/Edit/View/Search/Make/Run/Debug/Options/Help menus are separate from EDIT.
F2 saves, F7 builds a persistent same-basename `.CSX`, Ctrl+F5 runs the last
build, Shift+F5 builds and runs, and F4 toggles output. F5 starts or continues
the in-WorkBench instruction debugger, F8 traces one instruction, F9 toggles a
breakpoint at the current EIP, and Escape returns to source without discarding
the paused debuggee. DOS compile-only defaults to same-basename `.OBJ`; a linked
or executable build defaults to same-basename `.CSX`, never `a.o` or `a.out`.
The interface takes its workflow cues from 1990s DOS programmer workbenches, but
it is independent Computer System code and does not include Microsoft C/C++ 7.0,
Programmer's WorkBench binaries, artwork, help databases, OMF objects, or native
x86 tools.

WorkBench stores one constrained presentation state: exactly one primary Source,
Output, or Debugger surface plus at most one permitted overlay. Menus and the
Program List may remain over the Debugger where supported; selecting an editor
dialog first returns to Source so the dialog cannot open invisibly. A
profile-scoped command catalog keeps product boundaries explicit: CS QBASIC
supports transient source run but rejects CS ASM/C/C++ build and rebuild
shortcuts such as Alt+F7 and Ctrl+F7.

`EDIT`, CS QBASIC, and the WorkBench share the same bounded editor state
machine. Plain EDIT carries the title corner down a continuous left document
border. In an 80x25 session, Ctrl+O opens with selected `*.TXT`, a bounded Files
pane, a Dirs/Drives pane, and separate horizontal/vertical arrow tracks;
narrower sessions retain the compact fallback. Ctrl+O and Ctrl+Shift+S browse
only guest C: and A:, with directories, wildcard filters, keyboard and
primary-mouse selection, scrolling, explicit empty/not-ready states, and
removable-media generation checks. New, Open, Save As, overwrite,
external-change, and Exit paths retain the dirty buffer until the user chooses
Save, Discard/Reopen, or Cancel. Text is written as CRLF; NUL/Ctrl+Z binary
input, capacity-plus-one edits, stale media, and changed-on-disk saves fail
without partially replacing the buffer. The same core owns the Options dialogs,
completion popup, symbol list, definition history, and guest-command dialogs, so
modal keyboard/mouse ownership cannot be bypassed by WorkBench build/debug
shortcuts.

The CS ASM / CS C/C++ WorkBench can select a bounded `CS PROGRAM LIST 1.0`
project from Make > Set Program List. A list declares ordered `SOURCE` entries
for `.ASM`, `.C`, and `.CPP`, optional authored `OBJECT` inputs, `INCLUDE`,
`DEFINE`, `UNDEF`, `ENTRY`, required `OUTPUT`, and optional `LISTING` and `MAP`
paths. F7 incrementally rebuilds only units whose source, included headers,
options, or compiler identity changed; Ctrl+F7 rebuilds every source. Successful
output, objects, listing, map, and the ownership record are installed in one
guest filesystem transaction. A failed build preserves the last good executable
but marks Run Last stale. Clean removes only paths recorded as project-owned,
and canonical-path collisions with source, user objects, other outputs, or a
pre-existing unowned file are rejected before mutation. The F4 pane is
scrollable; F3 and Shift+F3 open the next or previous bounded DOS compiler
location in the editor. Compiler diagnostics retain their authored path, code,
span, and bounded notes as structured data. Output rows and F3 navigation are
derived from that same record, so DOS display formatting cannot rewrite the
canonical navigation target and changing output wording cannot break F3.

The WorkBench, EDIT, and Web Terminal mouse path are built-in privileged
sessions. Version-4 legacy word executables and version-5 model-declared CS486
executables launched in the CS-Linux foreground have CS ABI 1.0: immutable
bounded `argc`/`argv` and environment startup state, declared guest heap access,
credentialed data-model stream files, line-buffered `stdout`, unbuffered
`stderr`, deterministic ticks and sleep, a 64-key FIFO, and an at-most-80x25
packed cell framebuffer. `cs-word32-v1` streams one 32-bit character per unit;
`cs-byte8-v1` streams exact bytes with no implicit UTF-8 or newline conversion.
One validated frame consumes one terminal work unit; deferred terminal or block
I/O returns `EAGAIN` before mutation. Zero-length `CS_SYS_FS_WRITE` on
descriptor 1 is the guest-libc flush boundary, and process finalization also
flushes pending stdout exactly once. The opened-file table is capped at eight
descriptors in addition to 0/1/2, individual transfers at 4,096 model units, and
lifetime terminal output at 64,000 units. Background work, CS-DOS, debugger, and
Python-extension processes do not receive this hosted syscall surface. Mouse
events, sound, windows, arbitrary graphics modes, host devices, host files, and
native operating-system calls remain unavailable.

New CS ASM 1.0 objects use model-declared `CS486OBJ` v4, and linked programs use
`CS486` v5. A dedicated tokenizer, bounded preprocessor, parser,
constant-expression evaluator, and source-span diagnostics feed `.text`,
`.rodata`, `.data`, and `.bss` sections. Objects carry initialized little-endian
data, alignment, local/global/undefined symbols typed as `function`, `object`,
or `notype`, bounded function signatures such as `(i32,i64)->i64`,
`(i32,...)->i32`, or `()->void`, plus structured `text-target`, `data-address`,
and `absolute32` relocations. `ld` resolves Map-backed symbols and applies those
records in O(instructions + initialized bytes + symbols + relocations) work
rather than rewriting assembly text. The linked data image reserves address zero
as a null guard, so no real object or string literal can accidentally compare
equal to a null pointer. Readers retain v1-v3 word-object and v1-v4
word-executable compatibility. `nm`, `objdump`, and `csdb` report the declared
data model while inspecting current artifacts. These files are neither Linux ELF
nor DOS OMF, `.COM`, or `.EXE` files, and no frontend invokes a host assembler,
compiler, linker, or loader.

CS C/C++ 1.0 uses a dedicated, bounded tokenizer and parser instead of regular-
expression source rewriting. The parser builds a typed AST with lexical scopes
and source spans, requires a function declaration or prototype before each call,
and rejects calling an in-scope local that shadows a function. It then lowers to
CSIR. Computed CSIR values have one SSA definition while mutable C locals remain
explicit `load-local`/`store-local` operations; this is value SSA, not memory
SSA. A bounded verifier checks types, definitions, dominance, control-flow
targets, and explicit terminal states. Deterministic, pass-capped optimization
performs constant folding, copy propagation, unreachable-block cleanup, and
dead-pure-value elimination.

Before parsing, a bounded token preprocessor handles quoted and angle
`#include`, object-like and function-like `#define`, `#undef`, conditional
compilation, `defined`, line continuations, macro rescanning, stringification,
token pasting, and `#error`. CS-Linux accepts `-I`, `-D`, and `-U`; CS-DOS
accepts the same forms plus `/I`, `/D`, and `/U`, with `INCLUDE` providing
additional guest directories. Includes use the invoking guest credentials and
never read host files. Include depth/cycles, macro depth/tokens, conditional
depth, emitted tokens, source size, and diagnostics are bounded. Unsupported
directives such as `#pragma` and variadic macros fail explicitly.

The backend uses bounded deterministic linear-scan register allocation with
checked stack spills and EBP-based stack frames. ESP and EBP are reserved, and
values crossing a call are conservatively spilled under the current ABI. Up to
32 physical words are evaluated deterministically, pushed right-to-left, and
removed by the caller; callees read `[ebp+8+4i]` and preserve ESI/EDI/EBP. A
one-word result uses EAX, while a two-word `i64` result uses EAX for the low
word and EDX for the high word. Variadic signatures carry a checked hidden word
count between fixed and variable arguments; `<stdarg.h>` rejects over-read.
Validated `calli` admits only an exact function entry with the declared
signature and faults on null, data, middle-of-function, out-of-range, or
mismatched targets. Graph coloring is neither required nor implemented. C/C++
objects attach the known parameter/return signature to both defined and
undefined function symbols; the linker rejects conflicting known signatures
while retaining untyped ASM and v1 compatibility. Statement-boundary
`asm("...")` rejects labels, control flow, stack operations, and ESP/EBP access.
The current C++ frontend is the C subset plus bounded integer `std::cout` /
`std::endl`; classes, inheritance, references, overloads, namespaces, templates,
exceptions, RTTI, virtual dispatch, `constexpr`, and the ISO standard library
are not implemented. All exported functions use one unmangled CS object ABI. The
spelling `extern "C"` is accepted on individual C++ declarations, while linkage
blocks and other linkages are rejected. ASM contracts use `f32`, `f64`, `i32`,
`i64`, `void`, and optional `varargs`; there is no MASM name decoration,
near/far pointer model, C++ member ABI, DOS extender ABI, or compatibility with
Microsoft objects and libraries.

The default `cs-word32-v1` CS C data model defines `CHAR_BIT=32`;
signed/unsigned `char`, `short`, `int`, `long`, and every pointer each occupy
one 32-bit word. `long long`, `unsigned long long`, `int64_t`, and `uint64_t`
use two little-endian words. `cc -mbyte8` (or `-mdata-model=cs-byte8-v1`)
selects the additive `cs-byte8-v1` profile: `CHAR_BIT=8`, 8-bit `char`, 16-bit
`short`, 32-bit `int`/`long`/pointers, and 64-bit `long long`, with natural
little-endian array/struct/union padding. `-mword32` explicitly selects the
default profile. Objects, archives, executables, Make fingerprints, debugger
views, and rootfs libraries retain that identity; mixed-profile inputs fail
before output installation. Promotions, usual arithmetic conversions, unsigned
wrap/comparison/division, logical right shift, casts, constant expressions, and
debugger output follow that model. The bounded frontend supports pointers and
validated function pointers, word-scaled arithmetic, fixed multidimensional
arrays, structs, unions, designated initializers, compound literals, final
flexible arrays, deterministic low-bit-first 32-bit allocation units for
bit-fields, enums, typedefs, `_Bool`, `_Static_assert`, `alignof`, `__func__`,
file/local `static`, block/file `extern`, qualifiers, and bounded `goto` labels.
This layout is a CS word ABI, not native x86 structure or bit-field
compatibility.

`float` is little-endian IEEE-754 binary32 and `double` is binary64 in both data
models; `long double` is an explicit alias of `double`. They are four-byte
aligned. In `cs-word32-v1`, `sizeof(float)==1` and `sizeof(double)==2` word
units; in `cs-byte8-v1`, their sizes are four and eight bytes. Current function
signatures preserve `f32`/`f64`, binary64 arguments occupy two low-word-first
physical words, and binary64 returns use EDX:EAX. Decimal/hex literals, casts,
promotions, arithmetic, comparisons, constant folding, globals, aggregates,
callbacks, and spills all use the same bounded integer/rational software-float
semantics: round-to-nearest ties-to-even, signed zero, subnormals, infinities,
and canonical quiet NaNs. No guest result delegates to JavaScript floating
arithmetic, host libm, locale formatting, WebAssembly, or a native addon.

Constant-initialized globals use `.data` and zero-initialized globals use
`.bss`. Word-profile strings use one `dd` word per Unicode code point plus a
zero word; byte-profile strings and character arrays use packed single-byte
values plus a NUL byte. Guest-compiled `printf`, `fprintf`, and `snprintf` use
the verified variadic ABI and accept literal text, `%%`, and up to 32 checked
`%d`, `%i`, `%c`, `%s`, and `%f` conversions. Variadic `float` promotes to
`double`; `%f` defaults to six fractional places and caps precision at 18.
Format length, worst-case output, `%s` word reads, argument words, aggregate
size, initialized data, and diagnostics all have explicit ceilings. CS-Linux
rootfs v19 ships model-aware `<limits.h>`, `<stdint.h>`, `<float.h>`, and
`<math.h>`, model-matched libc/libcurses/libm archives, and `<cs/byte.h>` for
explicit four-octet packing in word-profile storage; that shim does not make
word `unsigned char *` source-compatible with byte-oriented code. Older rootfs
images, including the word-only v17 and pre-floating v18 images, stay immutable.

The initial deterministic libm profile supplies `fabs`, `copysign`, `floor`,
`ceil`, `trunc`, `round`, `fmod`, `sqrt`, `ldexp`, `frexp`, `modf`, `isnan`,
`isinf`, `isfinite`, and `signbit`, with appropriate binary32 variants. It maps
invalid results to `EDOM` and divide-by-zero/overflow/underflow to `ERANGE` via
process-local status. Trigonometric, exponential, logarithmic, `pow`, complex,
decimal floating point, mutable rounding modes, `<fenv.h>`, x87/native FPU,
SIMD, and fast-math are explicitly unsupported rather than host-approximated.

Rootfs v17 adds the guest-built hosted library profile. `<string.h>` and
`<stdlib.h>` include bounded conversions, O(N log N) callback `qsort`, O(log N)
`bsearch`, pointer-result `div` for the pointer-passed aggregate ABI, sixteen
reverse-order `atexit` handlers, and deterministic `getopt`/`getopt_long`.
Formatting supports bounded `-`/`0`, numeric width, and precision for the
profile's `%d`/`%i`/`%c`/`%s`/`%%` conversions. Credentialed cwd, directory,
extended-stat, access, directory creation/removal, unlink, and exclusive
temporary-file calls use one O(entries) snapshot per iterator; at most eight
iterators and 256 entries per snapshot are retained, and a filesystem revision
change invalidates the cursor with `EAGAIN`. `<time.h>` exposes deterministic
guest ticks through `clock()` and the injected OS wall-clock source through
`time()` without mixing the two. `<signal.h>` supports deterministic synchronous
`raise` callbacks; asynchronous HUP/INT/TERM delivery retains the runtime's
exactly-once default termination path, while KILL/STOP cannot install a handler.
The linker runs `__cs_run_atexit` after a normal `main` return when the guest
libc object is present.

The same image ships `/usr/src/libcs-curses/curses.c` and `<curses.h>` as a
fixed-cell compatibility layer: an 80x25 maximum screen, `stdscr` plus seven
additional windows, sixteen color pairs, a bounded 1,024-word formatting buffer,
owned key input, and one `TERM_PRESENT` call per refresh. It does not parse
terminfo or terminal escape sequences, spawn a host terminal, or claim full
ncurses/POSIX compatibility.

CS-Linux exposes the bounded instruction debugger as `csdb`; CS-DOS exposes the
same core through both the WorkBench Debug menu and the optional `DEBUG` command
with DOS spellings and CRLF output. After loading a validated CS486 executable,
it can pause at an instruction address, set or clear breakpoints, single-step,
continue with a bounded instruction budget, inspect registers, disassemble, and
read memory without modifying it. The hard ceilings are 256 breakpoints, 100,000
instructions per continue request, 256 instructions per disassembly request, and
4,096 bytes per memory read. Debug state is owned by the shell session and is
discarded on quit, logout, user switch, or terminal disconnect. This is not
native GDB or DOS DEBUG emulation: source-level debug, symbolic local-variable
reconstruction, memory writes, PIC/IRQ/IDT execution, and native BIOS/DOS
interrupts are not implemented.

Computer System Python 1.0 is targeting Python 3.14 syntax and core semantics;
this is not yet a compatibility claim. The profile deliberately omits `pip`,
`ensurepip`, `venv`, PyPI, and wheel installation. See
[the compatibility contract](docs/python-compatibility.md) and its
[machine-readable manifest](docs/python-314-compatibility.json) for the current
feature status and complete boundary. The direct frontend currently caps one
parse at 512,000 decoded source code units, 131,072 tokens, 512 code units per
identifier, 65,536 per literal, nesting depth 64, 16,384 statements, 256
parameters or call arguments, and 4,096 items per construct. Exact-limit input
is accepted; capacity plus one fails before an executable program is created.
Unicode XID identifiers use NFKC lookup normalization. Name operations carry an
explicit global, local, cell, or free binding; `global`, `nonlocal`, retained
nested closures, and shared nonlocal mutation execute through the same CS486
call/frame path. Reachable function defaults and captured values count toward
the managed heap, and failed source-module initialization rolls back its pending
alias and cache state before a later retry. Function signatures support
positional-only, positional-or-keyword, keyword-only, variadic positional, and
variadic keyword parameters. Defaults retain definition-time left-to-right
evaluation; calls evaluate items left to right and support bounded
iterable/mapping unpacking with a default 4,096-value expanded ceiling. Chained
comparisons short-circuit and evaluate each operand at most once. Conditional
expressions evaluate their condition first and only the selected branch.
Expression-only `lambda` functions reuse all five parameter kinds,
definition-time defaults, shared closure cells, heap accounting, and ordinary
CS486 call/return control flow. Identifier-only `:=` expressions evaluate one
RHS, store through the existing lexical binding, and return that same value;
restricted subexpressions require parentheses. List/set/dictionary
comprehensions evaluate the leftmost iterable in the enclosing scope, then run
bounded left-to-right synchronous `for`/`if` clauses in a non-leaking implicit
scope; comprehension `:=` targets bind in the containing scope and cannot
conflict with iteration targets. `assert` evaluates one condition, skips its
message on success, and raises `AssertionError` through the existing exception
path on failure. Chained assignment evaluates one RHS before left-to-right
targets; augmented identifier, attribute, and subscription targets are evaluated
once before their RHS and reuse the bounded numeric operations. List/tuple
displays expand iterable `*` items left to right, dictionaries merge `**`
mappings with later-key overwrite, and nested destructuring assigns one RHS with
one starred remainder list per nesting level. Mutable sets add explicit and
starred displays plus bounded `set()`, deterministic iteration, membership,
`len`, equality, and canonical primitive/tuple hashing; mutable elements raise
`TypeError`. Expanded values share the default 4,096-item collection ceiling and
managed heap. One built-in cursor protocol now backs `iter()`, `next()`, `for`,
unpacking, starred displays, iterable call expansion, slice replacement, and
`set()`. Existing iterators retain identity and position; exhaustion is stable,
`next()` raises catchable `StopIteration`, and its optional default is
supported. Class-backed, inherited `__iter__` and `__next__` now drive `iter()`,
`next()`, `for`, unpacking, starred displays, iterable call expansion, slice
replacement, `set()`, synchronous comprehensions, generator expressions, and
`yield from` through the same bounded Python call path; instance-only special
methods are ignored. `__iter__` may return a built-in cursor, a generator, or a
separate class-backed iterator. If the class path has no `__iter__`, inherited
`__getitem__` supplies independent zero-based sequence cursors; successful
results advance, `IndexError`/`StopIteration` make exhaustion sticky, and
another fault leaves the index unchanged. An explicit class-level `__iter__`,
including `None`, takes precedence. Each request remains a bounded managed CS486
call and the cursor keeps its source reachable. Materializing consumers retain
their iterator, accumulated values, pending operands/arguments/targets, and
original CS486 return slot together. Calls, target stores, slice mutation, and
result publication wait for iteration plus arity/capacity validation.
`iter(callable, sentinel)` evaluates both operands once, calls the first with no
arguments through the ordinary CS486 path, and stops before yielding an equal
sentinel result. Managed functions and lambdas, bound methods, classes, native
functions including waits, and CS486 extension exports are supported. A raised
`StopIteration` also makes exhaustion stable; another fault propagates without
exhausting the cursor. The callable, sentinel, and exhaustion flag stay in one
accounted iterator instance shared by every lazy and materializing consumer. A
directly containing `def` or `lambda` with `yield` now creates a lazy generator:
the call binds arguments without running the body, while `next()`, `for`, and
`send(None)` resume its compiled CS486 target and make the suspended yield
expression evaluate to `None`. `send(value)` supplies that exact managed value;
a non-`None` first send raises `TypeError` without consuming the generator.
Locals, closure cells, and the managed value stack survive each yield together
with active `try`/`except`/`finally` handlers, handled exceptions, and pending
finalizer continuations. `throw(exception)` injects at the suspended yield and
the bounded legacy type/value/`None` traceback form is accepted. `close()`
injects `GeneratorExit`, runs pending `finally` suites, returns a handled
generator return value, raises `RuntimeError` if the generator yields, and
propagates any other fault. `GeneratorExit` is a `BaseException`, not an
`Exception`. Stored bound `send`/`throw`/`close` methods and suspended exception
state retain their generator through the same reachable heap.
`yield from expression` evaluates one iterable once and delegates values lazily.
A subgenerator's return becomes the yield-from expression result; built-in
iterator exhaustion produces `None`, and user iterators supply their exact
`StopIteration.value`. `send`, `throw`, and `close` forward through generator
delegates, while missing methods on built-in iterators remain observable. The
complete delegation chain uses the same CS486 call/return path and reachable
heap. Synchronous generator expressions now reuse the comprehension implicit
scope and generator protocol. Their leftmost iterable expression and `iter()`
run once at construction; elements, filters, and later iterables remain lazy.
Targets do not leak, contained `:=` stores bind in the containing scope, and the
sole-call-argument form may omit its extra parentheses. Synchronous `with`
statements retain each class-backed bound `__exit__` before calling `__enter__`,
enter multiple items left to right, and exit them right to left. Target
assignment is protected; normal and control exits receive three `None` values,
while faults receive a stable type, the exact value, and profile traceback
`None`. Truthy exit results suppress faults, false results preserve their
identity, and bound exits remain reachable across generator suspension and
`close()`. The bound receiver plus three explicit exit arguments are preflighted
before entry. `async with`, `contextlib`, automatic garbage-collection close,
and other generator consumers remain later work. Bounded `class` definitions
evaluate zero or more bases once from left to right and execute an isolated
class namespace before constructing a C3 MRO and atomically publishing the
class. Instance lookup checks inherited data descriptors, instance attributes,
inherited non-data descriptors, then class values. Managed functions remain
non-data descriptors and bind only through class lookup. Class calls resolve
inherited `__new__` through the canonical C3 MRO. A plain managed `def __new__`
is implicitly static, receives the requested class plus the original constructor
arguments once, and may delegate to strict `object.__new__(cls)` for a
heap-accounted bare instance. A result that is an instance of the requested
class or a subclass invokes the returned type's inherited `__init__` and
enforces its `None` return; any other value is returned unchanged without
initialization. The retained constructor result uses the same compiled
after-call trampoline, call-depth ceiling, resumable slice path, and
reachable-heap accounting. The runtime exposes `object`, `isinstance`,
`issubclass`, and zero/one/two-argument `super`. Methods or lambdas that
reference `__class__` or builtin `super` capture one hidden class cell. It is
initialized after C3 and heap admission, before `__set_name__`, and cleared if
set-name completion fails. Bound super lookup resumes after its start class in
the receiver C3 MRO and reuses ordinary function, property, custom descriptor,
and classmethod binding; terminal cooperative initialization uses
`object.__init__`. Class and instance namespaces use the same 4,096-entry and
reachable-heap limits; each MRO is capped at 64 classes including `object`.
Classes expose `__name__`/`__base__`/`__bases__`/`__mro__`, instances expose
`__class__`, bound methods expose `__self__`/`__func__`, and super proxies
expose read-only `__thisclass__`/`__self__`/`__self_class__`. Inherited
`__get__`, `__set__`, and `__delete__` run through the same bounded CS486 call
path; class creation invokes inherited `__set_name__` in namespace order before
atomic publication. Explicit instance reads/writes/deletions support inherited
`__getattribute__`, AttributeError-only `__getattr__`, `__setattr__`, and
`__delattr__`, with `object` delegation and `getattr`/`setattr`/`delattr`.
Bounded `del` handles names, attributes, built-in list/dictionary items, list
slices, and nested target lists left to right. Metaclasses, `__slots__`, module
or metaclass attribute hooks, user-defined `__delitem__`, arbitrary native
descriptors, asynchronous descriptor/hooks, and operator protocols remain later
data-model work. Function and class decorators evaluate bounded
assignment-expression forms top to bottom before defaults or class construction,
apply bottom to top through the shared call path, and bind only after every call
succeeds. Intrinsic `property` supports getter/setter/deleter replacement, class
access, and explicit missing-accessor faults; `staticmethod` preserves its
wrapped value and `classmethod` binds the most-derived accessed class. All
retained descriptor state participates in the managed heap and existing
4,096-item, 64-call-depth, and instruction-slice limits. Built-in strings,
lists, and tuples accept clipped positive/negative slices; strings use Unicode
code points. List slice assignment supports resizing and fixed-length extended
replacement, with RHS-first target evaluation plus final capacity and arity
checked before mutation. Decimal, binary, octal, and hexadecimal integer
literals remain exact beyond the host safe-integer range. Integer arithmetic,
floor/modulo, powers, shifts, and bitwise operators use a bounded
arbitrary-precision representation with a 262,144-bit default ceiling; growth is
checked before power/left-shift allocation and reachable limb storage counts
toward the existing managed heap. Float semantics remain a partial IEEE 754
binary64 implementation.

Desktop Python resolves same-directory modules followed by `/lib/python` and
`/usr/lib/computer-system/python`. Regular source packages use `__init__.py`;
their parents initialize before children, children become attributes of their
parents, and absolute or explicit-relative `from` imports preserve Python name
binding. A plain dotted import binds the top-level package while `as` binds the
resolved leaf. Each module is compiled and initialized once, receives stable
`__name__`, `__package__`, and `__file__` metadata, and packages additionally
receive `__path__`. Partially initialized namespaces support ordinary circular
imports; an escaping fault removes the incomplete module and child publication
so a later import may retry. Namespace packages, zip imports, and dynamic import
hooks are unavailable. A versioned `.o` `CS486OBJ` module exposes only its
global `.text` zero-argument functions as Python attributes and executes them in
the same CS486 process with EAX returns. Global data symbols are never callable.
For example, `cc -c fastmath.c -o fastmath.o` beside a script enables
`import fastmath`. Missing, circular, oversized, corrupt, or ABI-incompatible
imports fail explicitly. `run --stats` reports the active CS486DX, CS486DX2, or
CS386SX model, instructions, CPU cycles, and virtual microseconds at its
persisted clock. Scheduled `run --stats` and `python --stats` also separate host
wall elapsed time from guest timing and report guest CPU cycles per host second
plus the modeled-real-time ratio; host delay never changes guest cycle counts.
On CS-DOS, `QBASIC file.bas` opens the CS QBASIC 1.0 IDE and
`QBASIC /RUN file.bas` compiles and runs its supported subset. `CSASM`, `CSCC`,
`CSCPP`, and `PWB` open the CS ASM 1.0 or CS C/C++ 1.0 WorkBench. No frontend
invokes a host compiler, linker, or native binary. General dynamic/shared
libraries remain a follow-up on the versioned object and ABI foundation. MCP's
`cpuCycles` field uses one unit across CS ASM 1.0, CS C/C++ 1.0, CS QBASIC 1.0,
and desktop Python; machine-instruction counts remain diagnostic values, not
timing units. The portable CS386SX retains CS ASM 1.0, CS C/C++ 1.0, CS QBASIC
1.0, and batch support, but rejects `python`/`micropython` commands with status
127 and does not execute `/startup.py`. CS QBASIC F5, Ctrl+F5, Shift+F5, and
`/RUN` execute the saved `.BAS` source in a transient validated process and
return output to the IDE. They do not create a `.OBJ`, `.CSX`, native `.EXE`, or
another persistent build artifact.

The native Python `shell` module is not a user API. It is enabled only for the
built-in shell program selected when `/startup.py` is empty. User-authored
`/startup.py`, foreground `python`/`micropython`, and MCP Python cannot import
it; each attempt fails explicitly instead of exposing a live terminal shell
object across an authentication boundary.

The Bedrock pack includes placeable `Computer` and `Advanced Computer` items
(`computer_system:computer_item` and `computer_system:advanced_computer_item`).
Their inventory icons are generated from the authored machine plates. The
Portable Computer System uses the matching authored plate as its held-item icon
and can transfer that identity into the placeable
`computer_system:portable_computer_block`; breaking it returns the same identity
to an item. Placed blocks use internal `computer_system:computer_00..63` or
`computer_system:advanced_computer_00..63` identifiers for their six-face
redstone-output mask. Each desktop is a single all-in-one block with a built-in
CRT; interacting with that Computer opens its Web Terminal handoff directly.
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
- A bounded direct Python-to-CS486 compiler using the shared process runtime
- Vitest-based host-side unit and compatibility tests

## License

No license has been selected yet. All rights are reserved until a license is
added.
