# GitHub workflow guidance

## Pages build and deploy

- `pages.yml` runs the complete `npm run validate` gate before upload:
  formatting, lint, TypeScript, all tests, production pack build, and static
  Pages build.
- Build and deploy are separate jobs with explicit `needs`, bounded 30/10-minute
  timeouts, the `github-pages` environment, and one non-cancelling `pages`
  concurrency group.
- Build gets `contents: read` and `pages: read`. Only deploy gets `pages: write`
  and `id-token: write`. Do not broaden workflow-level permissions.
- Preserve the base URL from `configure-pages`. Upload only `dist/pages` through
  `upload-pages-artifact`; include hidden files for `.nojekyll`. Never upload
  the repository root, `web/`, live companion/session code, `.env*`, BDS data,
  Bedrock packs, or unrelated artifacts.
- Keep `main`, the explicitly active publication branch, and manual dispatch
  triggers synchronized with `docs/development.md`. A trigger change is release
  policy, not cleanup.

## Publication recovery

The private repository's current plan rejects Pages enablement, so
`configure-pages` currently reads `Not Found`. Do not set `enablement: true`,
add a PAT, weaken permissions, or change visibility to bypass it.

After a compatible plan or explicitly approved visibility change:

1. Enable Pages with `build_type: workflow`.
2. Run **Deploy documentation to GitHub Pages**.
3. Require successful build and deploy jobs.
4. Read back Pages configuration and deployed URL.
5. Verify HTTPS landing/manual, repository base path, deep links, no-JS content,
   bounded search, back/forward, mobile, and 404 recovery.
6. Record Actions/browser evidence and close Issue #21 only after the URL is
   live.

## Maintenance

Read failed annotations/logs before editing. A plan/site-configuration failure
is not fixed by skipping validation or deployment security.
