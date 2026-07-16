# GitHub automation guidance

This parent owns automation security shared by every workflow.

## Child scopes

| Child scope                         | Responsibility                             |
| ----------------------------------- | ------------------------------------------ |
| [`workflows/`](workflows/CLAUDE.md) | Job, action, trigger, and deployment rules |

## Workflow security

- Default to no write permission and grant each job only the provider capability
  it needs. Child workflows own their exact permission matrix, environments,
  timeouts, dependencies, and concurrency policy.
- Pin official Actions to reviewed major versions and update intentionally. Do
  not add unreviewed third-party Actions or expose secrets to pull-request code.
- Do not print secrets, tokens, one-use URLs, private origins, or environment
  contents. Treat artifacts and annotations as public-readable evidence.

Workflow-specific triggers, artifacts, current external failure evidence, and
publication recovery belong to `workflows/CLAUDE.md`. Repository visibility
remains a user-owned decision under the root safety rule.
