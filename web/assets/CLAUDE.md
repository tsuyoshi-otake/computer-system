# Authored Web asset guidance

## Child scopes

| Child scope                       | Responsibility                                           |
| --------------------------------- | -------------------------------------------------------- |
| [`machines/`](machines/CLAUDE.md) | Three authored isometric desktop/portable machine plates |
| [`cpu/`](cpu/CLAUDE.md)           | Authored CS386SX/CS486DX/CS486DX2 identification plates  |
| [`manual/`](manual/CLAUDE.md)     | Manual-only explanatory machine illustrations            |

- These are authored source images served by the live manual and copied through
  the static Pages allowlist. They are not generated `dist/` output.
- Preserve meaningful filenames, transparency/background intent, intrinsic
  dimensions in manual markup, and useful alt text.
- Scoped `CLAUDE.md` files are private repository metadata and the Pages builder
  explicitly excludes them. Reject every other unexpected format, hidden file,
  symlink, or arbitrary extra asset. New files require an explicit publication /
  generator decision.
- Do not embed credentials, private origins, user/world screenshots,
  EXIF/location data, or workstation-specific information.
- Visual changes require relevant Pages/manual tests and a real-browser check.
  Derived pack art additionally requires generator tests, pack versioning, and
  real GDK verification.
