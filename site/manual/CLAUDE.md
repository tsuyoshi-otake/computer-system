# Static manual client guidance

## Canonical content

- Chapter prose, order, IDs, goal paths, and search records come only from
  `web/manual.js` through `tools/build-pages.mjs`. `index.template.html` and
  `app.js` own presentation/enhancement only.
- Every chapter and stable section target is pre-rendered and readable without
  JavaScript. Enhancement may hide inactive chapters only after initialization
  and must preserve semantic headings/anchors.

## Search and navigation state

- Use the canonical bounded search function and retain its 24-result ceiling.
  User queries are length-bounded and cannot create arbitrary regex execution or
  unbounded DOM work.
- Submit, reset, chapter links, result links, Previous/Next, `hashchange`,
  `popstate`, `pageshow`, and initial restoration keep URL query/hash, input,
  visible results, active chapter, focus target, and status text synchronized.
- Native form submission is intercepted without losing `?q=` state. Back/forward
  must restore search results as well as the chapter fragment.
- Deep hashes scroll/focus the intended stable target after its chapter becomes
  visible. Unknown hashes fail safely to a readable document rather than hiding
  all content.
- The bounded restoration timer is deduplicated; history events cannot start a
  retry/polling loop.

## Verification

Run `npm run test:pages`. In a real browser verify no-JS full reading, direct
chapter/section URLs, search/Enter/reset, result selection, Previous/Next,
back/forward with differing queries, reload, 404 recovery, focus, and desktop /
390 px layouts without horizontal overflow or console errors.
