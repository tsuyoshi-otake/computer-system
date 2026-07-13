# Development

## Host and vertical-slice verification

The language, VM, scheduler, computer lifecycle, terminal, filesystem,
persistence adapters, OS, and native modules run entirely outside Minecraft. Run
the complete host acceptance suite with:

```powershell
npm run validate
```

This checks formatting, lint, TypeScript types, deterministic host tests, and
the production Behavior/Resource Pack build. Phase evidence is recorded in
[`docs/issues/phase-1-host-runtime.md`](issues/phase-1-host-runtime.md) and
[`docs/issues/phase-2-computer-vertical-slice.md`](issues/phase-2-computer-vertical-slice.md).

## Supported Phase 0 environment

- Minecraft Bedrock Edition 1.26.30 or later in the 1.26 release line
- `@minecraft/server` 2.8.0
- `@minecraft/server-ui` 2.1.0
- `@minecraft/vanilla-data` 1.26.33
- Node.js 24 or later

The Phase 0 baseline intentionally uses stable Script APIs and does not require
the Beta APIs experiment.

## Commands

```text
npm install
npm run format
npm run validate
npm run deploy
```

`npm run build` creates development Behavior and Resource Packs under `dist/`.
`npm run deploy` replaces only the `computer_system_phase_0` development-pack
directories in the locally installed Bedrock GDK client. The deployment root is
`%APPDATA%\Minecraft Bedrock\users\shared\games\com.mojang`, which is the
current Windows creator-content location following the UWP-to-GDK migration.

When changing JSON UI under the Resource Pack, increment both the Resource Pack
header/module version and the Behavior Pack dependency version. Bedrock caches
server Resource Packs by UUID and version, so reconnecting to a restarted BDS
can otherwise continue rendering an older UI definition.

JSON UI overrides such as `ui/server_form.json` apply to the legacy form path
used by APIs such as `ModalFormData`. The reactive `CustomForm` API introduced
with Data-Driven UI (DDUI) uses a separate client-rendered screen: the 2.1.0 API
does not expose panel dimensions or font scaling, and the legacy
`server_form.custom_form` override does not affect it. Keep the DDUI terminal
when live output is required; switching to a legacy modal form trades that live
binding for Resource Pack-controlled layout.

For unrestricted desktop width and keyboard-first interaction, use the Web
Terminal companion. It renders the fixed-cell terminal snapshot in a normal
browser and positions its semantic input at the terminal cursor, preserving
physical Enter, Ctrl+C, and history without a separate visible text field. Start
the combined managed runtime with `npm run dev:bds:web`; see
[the MCP debugging guide](mcp-debugging.md) for network and security settings.

The Web Terminal and native fallback both send the same `terminal_line` event to
the Computer System OS. OS 0.2 parses a bounded BusyBox-style command language
with pipelines, redirects, control operators, quoting, variables, and script
files. Commands operate only on `InMemoryFilesystem`; they must never be
implemented by spawning a host shell. Focused verification is:

```powershell
npx vitest run tests/os/shellSyntax.test.ts tests/os/shellSession.test.ts tests/os/systemBoot.test.ts
```

`Verify:` Run `printf 'alpha\nbeta\nalpha\n' | grep alpha | wc -l > count`
through a `terminal_line` event, then run `cat count`.

`Expect:` `/count` contains `      2\n`, the terminal shows `2`, the runtime
returns to the explicit `waiting_event/terminal_line` state, and no host process
is created.

## Headless Bedrock verification

Download and extract the official Bedrock Dedicated Server distribution, then
point `BDS_HOME` at the extracted directory. Downloading the server constitutes
acceptance of the Minecraft EULA and Privacy Policy, so the repository tooling
does not download it automatically.

```text
$env:BDS_HOME="C:\path\to\bedrock-server"
npm run test:bds
```

The runner copies the distribution into a new isolated directory under
`~/tmp/computer-system-bds/`; it never modifies `BDS_HOME`. It creates a test
world, installs both Phase 0 packs, runs the stable Script API probes twice, and
requires both the World Dynamic Property sequence and non-stackable ItemStack
identity to survive the server restart. Every suite branch must emit a
`CS_PROBE_RESULT` terminal record. The runner uses an allowlist and keeps Xbox
Live authentication enabled so no player can join the isolated server.

The harness was verified against Bedrock Dedicated Server 1.26.33.2. Both
sessions completed with 20 computers receiving exactly 2,000 instructions over
40 ticks, and the Dynamic Property sequence advanced from 1 to 2 after restart.
The final Phase 0 bundle was 48,776 bytes. Both sessions measured every
scheduler tick below the millisecond clock resolution, stayed within the 50 ms
tick budget, and emitted zero memory warning signals. Both sessions also passed
transactional turtle operations, two pitched sound calls, six-face redstone
input sampling, all 64 independent digital output masks, all 16 Redstone
Interface analog levels, and simultaneous analog levels 4 and 12. Turtle probes
rejected occupied, unloaded, and conflicting moves without leaving an active
resource lease. The second session recovered the Pocket Computer ItemStack
identity written by the first, including placed-block and block-to-item identity
round trips. The custom item is parsed in the current direct-component format
and is verified as non-stackable before any Dynamic Property is written.

The arena loader polls a fixed set of required chunks for at most 40 ticks. Each
redstone output transition settles for at most eight ticks. These bounds prevent
startup races without turning either path into an unbounded retry loop.

The default isolated runtime is the stable
`%USERPROFILE%\tmp\computer-system-bds\runtime` directory. The runner safely
recreates this one managed directory on each run, so Windows Firewall can retain
a single application-path rule. Set `BDS_WORKDIR` only when a different explicit
empty work directory is preferred. The runner refuses a non-empty custom
directory and never recursively deletes it.

The remaining player-experience checks are listed in
[the manual verification checklist](manual-verification.md).

For persistent command execution and log inspection through Codex rather than
the Minecraft chat UI, use the local
[Bedrock MCP debug companion](mcp-debugging.md).

After activating both packs in a test world, run:

```text
/scriptevent computer_system:probe status
```

The script should acknowledge the probe in chat. The Dedicated Server console
uses `scriptevent computer_system:probe headless` for the complete automated
suite.

## Headless verification rubric

`Verify:` Run `npm run validate`.

`Expect:` Formatting, lint, type checking, all host tests, and the pack build
all exit successfully.

`Verify:` Set `BDS_HOME` and run `npm run test:bds`.

`Expect:` Both isolated sessions end in a `suite/PASS` terminal record; the
second session reports storage sequence 2, persisted item identity, six input
faces, 64 digital output masks, 16 analog levels, rejected turtle conflict and
unloaded movement, and runtime minimum/maximum 2,000. The summary also reports
the bundle byte count, average and maximum scheduler tick duration, the 50 ms
budget result, and zero memory warning signals.

`Verify:` Start one turtle operation while holding a lease on its destination,
then target an unloaded coordinate and inject a failure after world mutation.

`Expect:` The results are `conflict`, `unloaded`, and `rolled_back`; the source
marker remains intact and the active resource count returns to zero after every
terminal branch.
