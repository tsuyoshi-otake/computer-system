# Static publication guidance

## Boundary

`site/` contains authored templates and presentation code for the public static
landing page and field manual. It is documentation only.

## Child scopes

| Child scope                   | Responsibility                                     |
| ----------------------------- | -------------------------------------------------- |
| [`manual/`](manual/CLAUDE.md) | Manual progressive enhancement, search, navigation |

- The site cannot connect to BDS, accept a Computer number, exchange/hold a
  bearer token, display a live terminal, submit guest input, call `/api/*`, or
  imply that a local companion is reachable.
- Never copy `web/index.html`, `web/app.js`, session code, terminal controls, or
  connection forms into this site. Link users back to local operator
  instructions for live operation.
- Manual prose and IDs come only from `web/manual.js`. Templates own layout and
  progressive enhancement, not a second publication source.

## Static publication behavior

- Support arbitrary project/repository base paths. Asset, landing/manual,
  stylesheet/script, sitemap, robots, and 404 recovery links must not assume
  `/`.
- Generated output is `dist/pages` and is never committed. Keep the output
  allowlist exact and include `.nojekyll`; reject unexpected files and symlinks.

## Visual system and accessibility

- Preserve the project-specific “1993 technical publication × Minecraft machine
  room” visual language: paper/ink and terminal colors, strong typographic
  hierarchy, square technical panels, no gradients, and no generic rounded-card
  treatment.
- Keep semantic landmarks, skip link, visible focus, labeled search, useful alt
  text, sufficient contrast, keyboard navigation, reduced-motion compatibility,
  and at least 44 px touch targets where controls collapse on mobile.
- Desktop and narrow mobile layouts must not overflow horizontally. Decorative
  changes must not obscure code, tables, chapter anchors, or focus state.

## Verification

Run `npm run build:pages` and `npm run test:pages`, inspect the exact
`dist/pages` allowlist, and test landing, no-JS links, 404 recovery, desktop,
and mobile in a real browser. The child manual scope owns its interactive
matrix. A local pass does not prove the deployed GitHub Pages URL; verify it
separately.
