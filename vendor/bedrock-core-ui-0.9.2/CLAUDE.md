# Vendored Bedrock Core UI guidance

## Provenance

This is the pinned MIT-licensed Bedrock Core UI 0.9.2 snapshot from upstream
commit `5e87db65007cf554328374aa9aa6363034f3512d`. Preserve `README.md`, `LICENSE`,
version attribution, and upstream provenance.

- Treat `flexbox/` and `ui-runtime/` as vendored source. `compiled/` is generated
  by `npm run build:vendor-ui`; do not hand-edit compiled output independently.
- Update runtime source, compiled modules, declarations, and the Resource Pack
  protocol-v0007 JSON UI decoders/assets together. Their serialized protocol must
  remain exactly compatible.
- Keep the vendor build isolated through its local `tsconfig.build.json`. Do not
  make the application type checker depend on uncompiled vendor internals.
- Do not disable TLS verification, replace the pinned source with an unreviewed
  registry download, or silently mix files from different upstream revisions.
- Keep local modifications minimal and documented. Prefer an upstream-compatible
  patch over project-specific policy embedded in the vendor runtime.

## Verification

Run `npm run build:vendor-ui`, then the full production pack build. For protocol,
layout, cursor, field, or button changes, verify the native Resource Pack UI in
the real GDK client.
