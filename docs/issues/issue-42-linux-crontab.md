# Issue #42: system crontab command surface

Status: implemented and host-verified; real BDS verification remains part of the
repository-wide final gate.

## Implemented boundary

- `crontab -l` reads the authoritative `/etc/crontab`.
- Root `crontab -e` opens that exact file in the existing `vi`; there is no
  per-user spool or second scheduling truth.
- The cron service parses at most 64 bounded seven-field system entries only at
  service start/restart, evaluates the deterministic guest calendar, resolves
  the named user from the authoritative account database, caps the pending queue
  at 64, and starts at most one due job per tick.
- Day-of-month/day-of-week wildcard behavior follows the Vixie cron rule.

## Acceptance evidence

- Verify: `npm test -- tests/os/linuxCron.test.ts` Expect: listing/editing,
  permissions, syntax, calendar semantics, reload, queue bounds, identity, and
  process finalization tests all pass.
- Verify: `npm run validate` Expect: the complete repository validation gate
  passes.
