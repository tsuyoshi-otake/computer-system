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
- Keep the `main` and manual dispatch triggers synchronized with
  `docs/development.md`. A trigger change is release policy, not cleanup.

## Publication status and recovery

The public site is live at `https://tsuyoshi-otake.github.io/computer-system/`.
The first successful `main` deployment was Actions run `29541984914`; Chrome
verified the landing page, 16-chapter manual, and `manual/#chapter-basic` deep
link with zero console errors.

If publication later fails:

1. Read failed annotations and logs before editing.
2. Confirm Pages still uses `build_type: workflow`.
3. Require successful build and deploy jobs without weakening permissions,
   environment protection, validation, or artifact boundaries.
4. Read back Pages configuration and deployed URL.
5. Verify HTTPS landing/manual, repository base path, deep links, no-JS content,
   bounded search, back/forward, mobile, and 404 recovery.

## Maintenance

Read failed annotations/logs before editing. A plan/site-configuration failure
is not fixed by skipping validation or deployment security.
