# Resource Pack UI texture guidance

- UI textures are generated or explicitly allowlisted assets for the vendored
  protocol UI: cursor, unstyled controls, fields, and primary/danger buttons.
- Preserve required PNG dimensions, alpha, edge pixels, nine-slice assumptions,
  naming, directory structure, and JSON UI references. Reject unsupported source
  formats rather than converting silently.
- Do not replace project-authored Web machine/CPU plates or use those isometric
  images as UI/button/block-face textures.
- A texture change requires deterministic generator/test updates where
  generated, a Resource Pack version bump, and real GDK verification at
  representative UI scales and states (normal, focused, pressed, disabled,
  danger).
