# Machine plate guidance

- This directory owns the three authored isometric plates for the all-in-one
  Computer System, all-in-one Advanced Computer System, and Portable Computer
  System.
- Manual Chapter 09 (`architecture`) serves the plates directly. Keep machine
  family, proportions, built-in display/keyboard details, orientation,
  transparent canvas, and filenames aligned with manual labels and hardware
  profiles.
- `tools/machine-textures.mjs` derives bounded transparent 256 px item icons
  from these sources. A source change must remain within its supported PNG
  contract or fail explicitly; do not add implicit conversion/fallback.
- `tools/machine-block-assets.mjs` creates purpose-built geometry/atlas/16 px
  face textures. Never map these isometric plates directly onto block-face UVs.
- Verify source dimensions/alpha, deterministic derived icons, the
  `architecture` chapter layout, pack version bump, inventory icon, placed block
  geometry, square desktop top/rear cabinet corners, right-mounted 3.5-inch
  drives, and Portable item/block visual identity in browser and real GDK.
