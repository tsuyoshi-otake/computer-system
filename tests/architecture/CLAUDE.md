# Architecture test guidance

- These tests enforce dependency direction and host/guest shell isolation. A
  failure is not fixed by widening an allowlist until the new dependency is
  proven architecturally correct.
- The dependency scanner covers relative imports across `src/domain`,
  `src/application`, and adapters. Update the scanner when introducing a new
  source extension, import form, alias, or layer so the boundary remains
  complete.
- Domain/application code cannot import Minecraft, Web, host-process, or outward
  adapter implementations. Guest shell paths cannot reach Node child processes,
  PowerShell, `cmd.exe`, host tools, or arbitrary BDS commands.
- Source-string checks are evidence of static structure only. They do not prove
  runtime finalization, Minecraft behavior, or security outcomes; pair changes
  with owning subsystem tests.

## Focused verification

Run `npm test -- tests/architecture`. Include a negative fixture for any new
forbidden edge and ensure scans remain bounded to production source.
