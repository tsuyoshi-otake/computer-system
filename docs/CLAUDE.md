# Documentation guidance

## Child scopes

| Child scope                           | Responsibility                                                 |
| ------------------------------------- | -------------------------------------------------------------- |
| [`issues/`](issues/CLAUDE.md)         | Phase/Issue evidence snapshots and acceptance traceability     |
| [`benchmarks/`](benchmarks/CLAUDE.md) | Reproducible guest benchmark definitions and result provenance |

- `development.md` owns local setup, commands, build, test, and deployment.
- `mcp-debugging.md` owns MCP/BDS operation and troubleshooting.
- `manual-verification.md` owns reproducible GDK/Web/manual acceptance evidence.
- `os-presence.md` owns the OS-state architecture and implementation boundary.
- `work-monitor.md` owns admission/measurement semantics.
- `roadmap.md` and `issues/` describe planned scope and historical issue
  evidence.

The root guidance owns `README.md` as the project/operator entry point. The
user-facing 16-chapter manual is authored only in `web/manual.js`. Do not fork
its chapter prose or IDs into Markdown. Docs may explain maintenance,
verification, deployment, or architecture and should link to the canonical
publication source.

## Accuracy and status

- Keep docs synchronized with commands, defaults, limits, migration, security,
  hardware, OS behavior, UI, and known incompatibilities in the same change.
- Distinguish implemented, verified, modeled, future-ready, and unsupported
  behavior. Never describe a schema boundary or reserved lane as a shipped user
  feature.
- Historical observations include date, environment, build/profile, exact
  `Verify:` action, and observable `Expect:`/result. Move time-specific live
  GDK, browser, BDS, and Actions findings here rather than turning them into
  global coding rules.
- Label guest `cpuCycles`/diagnostics as modeled cost and MCP/browser wall time
  as responsiveness. Sequential success is not multi-user capacity evidence.
- Document first-boot `cs`, locked root, complete legacy `computer` migration,
  authentication masking, and recovery ownership consistently across operator
  and user-facing material.
- Never include plaintext passwords, bearer tokens, one-use URLs, private
  origins, workstation-specific LAN addresses, or live world data.

## GitHub Pages

- Describe Pages as a static reference, never a terminal endpoint.
- Reflect the publication safety boundary from the root and the exact recovery
  procedure from `.github/workflows/CLAUDE.md`. Do not claim publication until
  deployment and URL readback pass. Once live, update README/development/manual
  verification with the verified URL and close Issue #21 with Actions and
  browser evidence.

## Change discipline

- Keep issue numbers and implementation status current. Add Issue evidence for
  major architectural, migration, security, or acceptance work.
- Use stable relative links and headings. Verify referenced files/commands
  exist.
- Run formatting and link/search checks relevant to the edited documents, then
  the repository validation gate for non-trivial changes.
