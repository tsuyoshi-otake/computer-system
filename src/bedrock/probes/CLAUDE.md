# Bedrock probe guidance

## Purpose and isolation

- Probes establish observable production behavior through Minecraft Script API;
  they are not alternate implementations of the feature under test.
- Reuse production adapters/services. Probe-only code may stage bounded world
  fixtures and collect results but must not bypass authentication, credentials,
  scheduler admission, persistence, topology, or finalization.
- Own and release every staged block, item, entity, lease, session, timeout, and
  listener. A failure or disconnect still restores the probe arena explicitly.

## Probe protocol

- Keep probe request/response schemas versioned, allowlisted, length-bounded,
  and free of bearer tokens, one-use URLs, passwords, private origins, host
  paths, or arbitrary commands.
- Emit one stable `name/PASS` or explicit failure record per acceptance. Logs
  are evidence, not control flow; do not infer success from silence.
- Host startup grace, player-join waits, bounded `competing_form` retry, and log
  waiting belong to `tools/`; probes only publish the Script API result.

## Specific evidence

- Authentication proves pre-login MCP rejection, masked first-boot setup,
  rebooted `cs` username/password login, authenticated `whoami`, explicit
  runtime shutdown, and absence of the probe password before emitting the stable
  `linux_authentication/PASS` record.
- Serial matrix acceptance uses three machines, six faces, 36 ordered links, and
  72 bidirectional Linux ttyS/DOS COM transmissions before cleanup.
- UI probes verify the production fixed-cell form and exactly one close result;
  visible behavior still requires real GDK observation.
- Disconnect probes exercise finalization while work/session state is live; they
  cannot simply call the normal success teardown first.

## Verification

Use matching `tests/computer/`, `tests/io/`, and `tests/bedrock/` host
contracts, then the smallest `npm run test:bds`, `npm run test:bds:disconnect`,
or isolated MCP acceptance. Inspect bounded logs for watchdog, crash, fatal,
duplicate result, leaked fixture, and slow-tick evidence.
