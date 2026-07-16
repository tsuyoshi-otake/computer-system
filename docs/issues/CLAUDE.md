# Issue evidence guidance

- Files here are durable phase/Issue scope and acceptance evidence, not a second
  live issue tracker. Keep the linked GitHub Issue number, status, dependencies,
  implemented boundary, exclusions, and verification evidence explicit.
- Distinguish planned, in progress, implemented, host-verified, real-BDS/GDK /
  browser-verified, blocked, and deferred. Do not rewrite historical claims as
  if they were verified by later unrelated work.
- Every acceptance item names an executable `Verify:` and observable `Expect:`.
  Link exact tests/docs/log records without pasting secrets or unbounded logs.
- When scope moves between issues, retain traceability and update the root Issue
  map, roadmap, relevant source/manual guidance, and GitHub Issue comments.
- Do not mark an issue complete because code builds. Required migrations,
  negative/security paths, real-client behavior, docs/manual, and external
  deployment evidence must be satisfied or explicitly remain open.
- Preserve chronological facts such as environment, date, version/profile, and
  known residual risk. Never include bearer tokens, passwords, one-use URLs,
  private origins, workstation IPs, or live world contents.

## Verification

Check referenced paths/commands/issues, run the smallest cited acceptance, and
ensure current status agrees with GitHub before changing completion language.
