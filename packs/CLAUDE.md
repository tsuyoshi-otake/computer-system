# Bedrock pack guidance

## Child scopes

| Child scope                       | Responsibility                                                               |
| --------------------------------- | ---------------------------------------------------------------------------- |
| [`behavior/`](behavior/CLAUDE.md) | Behavior Pack manifest, loot, localization, and generated script contract    |
| [`resource/`](resource/CLAUDE.md) | Resource Pack manifest, localization, JSON UI, textures, and protocol assets |

Production output is assembled into `dist/` by `tools/build.mjs`; never commit
`dist/` as authored pack source.

## Cross-pack contract

- Keep pack UUIDs, dependencies, minimum engine versions, module versions,
  identifiers, localization keys, and cross-pack references synchronized.
- Increment the affected pack version whenever shipped files or behavior change
  so Bedrock clients/servers do not retain an incompatible cached pack.
- Generated artifacts come from allowlisted tools. Do not hand-edit a generated
  file independently of its authored source, generator, deterministic test, and
  pack version.
- Unsupported engine behavior fails during build/probe rather than shipping a
  silently degraded contract.

## Verification

Run `npm run build`, inspect both generated manifests/file sets, and use the
real BDS/GDK client for behavior, UI, texture, or interaction changes.
