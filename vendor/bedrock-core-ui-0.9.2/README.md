# Vendored Bedrock Core UI runtime

- Upstream: https://github.com/bedrock-core/ui
- Version: 0.9.2
- Tag commit used for this snapshot: `5e87db65007cf554328374aa9aa6363034f3512d`
- License: MIT; see `LICENSE` in this directory.
- Included code: `packages/ui-runtime/src` and `packages/flexbox/src`.
- Generated code: `compiled/`, built with the isolated upstream-compatible
  `tsconfig.build.json`; adjacent declarations keep application type checking
  out of the vendored implementation internals.
- Included Resource Pack companion: protocol-v0007 JSON UI decoders plus the
  minimal cursor, unstyled, field, primary-button, and danger-button textures.

The source is vendored because the development machine rejected the npm
registry's certificate chain. TLS verification was not disabled. Update the
runtime code and companion Resource Pack together because their serialized
protocol must match.
