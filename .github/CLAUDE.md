# GitHub automation guidance

## Workflow security

- Use least privilege per job. Repository checkout/build gets `contents: read`;
  Pages metadata setup gets `pages: read`; only the deploy job gets
  `pages: write` and `id-token: write`.
- Keep build and deploy separate with explicit `needs`, the `github-pages`
  environment, bounded timeouts, and concurrency that prevents overlapping Pages
  publication without cancelling an already admitted deployment.
- Pin official Actions to reviewed major versions and update intentionally. Do
  not add unreviewed third-party Actions or expose secrets to pull-request code.
- Do not print secrets, tokens, one-use URLs, private origins, or environment
  contents. Treat artifacts and annotations as public-readable evidence.

## Pages workflow

- `.github/workflows/pages.yml` runs the complete `npm run validate` gate before
  upload. It publishes only `dist/pages` through `upload-pages-artifact`, with
  hidden-file inclusion required for `.nojekyll`.
- Preserve repository-base-path configuration from `configure-pages`. Never
  upload repository root, `web/`, live companion code, `.env*`, BDS data, or
  generated Bedrock packs as the Pages artifact.
- Branch triggers are deliberate release/verification policy. Keep `main`, any
  explicitly active publication branch, and manual dispatch synchronized with
  the current workflow documented in `docs/development.md`.

## Current external blocker

The repository is private and its current GitHub plan rejects Pages enablement
with HTTP 422. `configure-pages` therefore reads `Not Found` after the corrected
`pages: read` permission. Do not weaken permissions, inject a PAT, or set
`enablement: true` to work around the plan, and never change repository
visibility without explicit user authorization.

After a compatible plan or approved visibility change:

1. Enable Pages with `build_type: workflow`.
2. Run **Deploy documentation to GitHub Pages**.
3. Require successful build and deploy jobs.
4. Read back the Pages configuration and verify landing, manual, deep links, 404
   recovery, and HTTPS at the deployed URL.
5. Record evidence and close Issue #21 only after the URL is live.
