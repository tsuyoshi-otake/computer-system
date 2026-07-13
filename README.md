# Computer System

Computer System is a ComputerCraft-inspired programmable computer add-on for
Minecraft Bedrock Edition.

The project aims to reproduce the ComputerCraft experience as closely as the
Bedrock Add-On and Script APIs allow. Programs use a sandboxed,
MicroPython-compatible language called Computer System Python, while the
computer lifecycle, terminal, filesystem, events, networking, peripherals,
pocket computers, and turtles follow ComputerCraft-style behavior.

## Status

The Phase 2 Bedrock Computer vertical slice is implemented. The language, VM,
scheduler, computer lifecycle, terminal model, filesystem, persistence, redstone
adapters, pocket computer identity, monitor fallback, and bounded Bedrock probes
are covered by host and Bedrock Dedicated Server verification.

The repository also includes a local stdio MCP companion that can build the
packs, run an isolated BDS instance, execute allowlisted Computer System probes,
and return bounded server logs to Codex. The real MCP-to-BDS headless workflow
passes with zero diagnostics.

The native in-game terminal remains available as a bounded fallback, but the
preferred interactive experience is now the local Web Terminal companion. Using
a Pocket Computer requests a short-lived browser link and connects the browser
directly to the same fixed-cell terminal model. The Web Terminal provides a
full-width Linux-style screen, inline cursor-positioned input, physical Enter,
Ctrl+C, and command history without relying on Bedrock's narrow CustomForm
container.

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
npm run deploy
npm run test:bds
npm run test:bds:disconnect
npm run test:mcp
npm run test:mcp:bds
npm run test:web
npm run dev:bds:web
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

For interactive work, start the MCP-managed server with the debug world
preserved, connect Minecraft to the reported port, and run player-scoped probes
through MCP. On Windows installations where Minecraft rejects `127.0.0.1` with
`InitialConnection-13`, use the machine's active LAN IPv4 address instead. See
[the MCP debugging guide](docs/mcp-debugging.md) for the complete workflow and
safety constraints.

## Browser terminal

Start the combined BDS and Web Terminal companion, then connect Minecraft to the
reported Minecraft address and port:

```powershell
$env:BDS_HOME = "C:\path\to\bedrock-server"
npm run dev:bds:web
```

Using a Pocket Computer prints a one-use browser link in Minecraft. The link is
valid for 60 seconds; opening it exchanges the handoff code for a browser-only
bearer token that is never written to BDS logs. The authenticated session lasts
at most 30 minutes. If the companion does not answer within 10 seconds, the
add-on opens the native in-game terminal instead.

The default Web Terminal listens only on `127.0.0.1:19144`, so it does not need
an additional firewall or router rule when Minecraft and the browser run on the
server machine. For trusted LAN access, expose TCP 19144 explicitly and publish
an address that the client can reach:

```powershell
$env:WEB_COMPANION_HOST = "0.0.0.0"
$env:WEB_COMPANION_PUBLIC_HOST = "192.168.1.10"
npm run dev:bds:web
```

Minecraft/BDS and the Web Terminal use different transports: the managed BDS
defaults to UDP 19142, while the browser companion defaults to TCP 19144. For
Internet access, keep the companion bound to loopback and put an HTTPS reverse
proxy on TCP 443 in front of it:

```powershell
$env:WEB_COMPANION_HOST = "127.0.0.1"
$env:WEB_COMPANION_PUBLIC_ORIGIN = "https://terminal.example.com"
npm run dev:bds:web
```

Do not expose the plain HTTP companion port directly to the Internet. The
reverse proxy should terminate TLS and forward only to `127.0.0.1:19144`.

## BusyBox-style shell

Terminal commands execute inside the Computer System sandbox, never in the host
Windows or BDS process. The OS 0.2 shell provides a practical BusyBox-style
subset:

```text
files:  pwd cd ls cat mkdir touch rm cp mv find
text:   echo printf head tail wc grep sort uniq tr
shell:  sh bash source env export unset which type
system: clear edit shutdown reboot exit true false
```

The parser supports single and double quotes, backslash escapes, environment
variables, `$?`, pipelines (`|`), input/output redirection (`<`, `>`, `>>`), and
control operators (`&&`, `||`, `;`). `sh file`, `source file`, and
`bash -c "command"` execute bounded scripts inside the same filesystem. Command
length, tokens, pipeline stages, script depth/lines, and intermediate output are
limited so shell work cannot become an unbounded server load path.

Examples:

```sh
ls -la /
printf 'alpha\nbeta\nalpha\n' | grep alpha | wc -l
echo 'hello world' > message.txt
cat message.txt | tr a-z A-Z
false || echo recovered
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
