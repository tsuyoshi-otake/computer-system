# Static publication guidance

## Boundary

`site/` contains authored templates and presentation code for the public static
landing page and field manual. It is documentation only.

- The site cannot connect to BDS, accept a Computer number, exchange/hold a
  bearer token, display a live terminal, submit guest input, call `/api/*`, or
  imply that a local companion is reachable.
- Never copy `web/index.html`, `web/app.js`, session code, terminal controls, or
  connection forms into this site. Link users back to local operator
  instructions for live operation.
- Manual prose and IDs come only from `web/manual.js`. Templates own layout and
  progressive enhancement, not a second publication source.

## Static and enhanced behavior

- Pre-render every chapter and stable section target. The complete manual, table
  of contents, reading routes, and section links remain usable with JavaScript
  disabled.
- Enhanced search uses the canonical search function and retains the 24-result
  bound. Submit, reset, hashchange, popstate, and restored-page paths keep URL,
  query, visible results, and active chapter synchronized.
- Support arbitrary project/repository base paths. Asset, landing/manual,
  stylesheet/script, sitemap, robots, and 404 recovery links must not assume
  `/`.
- Deep links and 404 recovery preserve chapter/section fragments and bounded
  search state without redirect loops.
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
`dist/pages` allowlist, and test landing, manual, search, no-JS reading, deep
hashes, back/forward, 404 recovery, desktop, and mobile in a real browser. A
local pass does not prove the deployed GitHub Pages URL; verify deployment
separately.
