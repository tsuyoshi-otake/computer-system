# Vendored flexbox source guidance

- Preserve upstream 0.9.2 layout semantics and public types. Local changes are
  narrowly documented compatibility patches, not a project-specific CSS engine.
- Layout is deterministic and bounded by the supplied tree. Validate finite
  dimensions, constraints, direction/alignment, margins/padding/gaps, and child
  ownership before calculation; do not consult DOM, host viewport, or Minecraft.
- Keep traversal/layout O(nodes) or otherwise document and test any extra factor.
  Avoid repeated full-subtree scans inside each node and input-dependent recursion
  without a depth bound.
- Preserve upstream `__tests__` and add a configured focused regression for a
  local patch. Cover zero/finite bounds, nested rows/columns, grow/shrink,
  alignment, wrapping, absolute positioning where supported, and deterministic
  repeated layout.

## Verification

Run `npm run build:vendor-ui`, the project pack build, and a configured regression
that actually includes the affected vendor test. Direct project Vitest currently
excludes vendor tests. Visible geometry changes require real GDK form
verification.
