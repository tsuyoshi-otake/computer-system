# Tooling test guidance

## Isolation

- Use isolated free/ephemeral ports, task-specific workdirs, deterministic IDs /
  clocks/randomness, and owned servers/processes. Always stop owned resources
  and never reset the interactive managed BDS world.
- Exercise invalid input, capacity-plus-one, timeout, retry/backoff, disconnect,
  cleanup, and secret redaction. Passwords, bearer tokens, one-use URLs, private
  origins, and host paths must not enter logs/snapshots/errors.
- Source-string UI tests are static-contract evidence and never replace a real
  browser, GDK, or BDS acceptance.

## Focused ownership

- `npm run test:web`: session store, companion/config, writer authority, range,
  retries, power/input relays, and live Web contract.
- `npm run test:pages`: exact static allowlist, canonical `web/manual.js`
  agreement, 16 chapters/IDs/paths, base paths, no-JS content, bounded search,
  history/deep links, 404 recovery, and no live session code.
- `npm run test:mcp`: debug-session/server allowlist, exact Computer identity,
  bounded non-TUI commands/output/timeouts, waiter ownership, and host-shell
  isolation.
- `npm run test:mcp:bds`: managed real-BDS smoke and Linux authentication.
- `npm run test:mcp:serial:bds`: isolated real-BDS serial matrix.
- Asset/build tests verify supported inputs, deterministic exact output, no
  symlinks/unexpected files, dimensions/alpha, and explicit rejection.
- `claudeGuidance.test.mjs` recursively validates the instruction hierarchy; do
  not replace it with a flat root list as deeper scopes are added.

## Manual agreement

`webManual.test.mjs` locks chapter order/header agreement, stable IDs, goal
paths, search bound, and navigation. Update canonical manual and agreement tests
in one change. Browser verification covers behavior that source/DOM fixtures
cannot.
