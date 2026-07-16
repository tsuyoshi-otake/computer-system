# Domain guidance

## Scope and purity

This directory contains deterministic domain models. Do not import Minecraft,
Node host-process APIs, Web transports, storage adapters, wall-clock timers, or
application services. Inject time, persistence, I/O, and admission decisions
through explicit abstractions.

## Filesystem and storage models

- `InMemoryFilesystem` is the persistence-capable filesystem model, not an OS
  shell. Keep Linux/DOS path dialect, aliases, boot layout, virtual devices, and
  user-facing text behind `src/application/os/osProfile.ts` and guest wrappers.
- Preserve mode, UID, GID, mtime, symbolic links, inode identity, shared
  hard-link contents, content-addressed blobs, and deletion tombstones in
  backward-compatible snapshots. Hard-link counts must remain O(1) so `ls -l`
  stays O(N).
- Filesystem transactions must restore bytes, inode/link identity, metadata,
  revision, byte/blob accounting, and tombstones exactly after injected failure.
- Support immutable shared base content plus per-Computer copy-on-write
  overlays; the OS application owns image composition and executable discovery
  policy.

## CPU and execution identity

- Keep one shared executable and ABI representation for ASM, BASIC, C, C++, and
  Python; never fork a language-specific CPU engine.
- Persist CPU identity, clock, and RAM together. Defaults are CS486DX 33 MHz / 2
  MiB for Desktop, CS486DX2 66 MHz / 8 MiB for Advanced Desktop, and CS386SX 16
  MHz / 2 MiB for Portable. Migration may rewrite only an exactly recognized
  former default and must preserve customized fields.
- Instruction timing lookup is O(1). CS386SX models Intel 80386 arithmetic,
  branches, early-out multiply, and 16-bit bus penalties. CS486DX and DX2 share
  486 instruction costs and differ by clock.
- `CpuMemoryHierarchy` is transient, fixed-size, and O(1) per access. CS386SX
  has no cache and uses two aligned or three odd-addressed transfers for a
  32-bit access. CS486DX has a cold 8 KiB four-way unified, 16-byte-line,
  write-through L1; DX2 adds a 256 KiB L2. Do not persist tags, recency,
  prefetch state, or counters.
- Neither CPU has dynamic branch prediction. Count taken control transfers as
  deterministic pipeline/prefetch flushes. Keep `run --stats`, CSBIOS, CPU
  identity, tests, and manual diagnostics synchronized.

## Device and display models

- Portable, Desktop, and Advanced Desktop fixed disks are 20, 40, and 80 MiB.
  IDE timing models controller setup, CHS seek, 3,600 RPM rotation, PIO
  transfer, and write settling.
- The future 1.44 MiB FDD models 80 cylinders, two heads, 18 sectors/track, 300
  RPM, motor state, media generations, write protection, ejection, and
  controller/DMA timing. Production media remains absent until an insertion
  adapter ships. Bound queues, requests, and completion delivery.
- Persist only the versioned display-profile ID, never framebuffer bytes or
  display revision. Portable uses `portable-vga-256k`; Desktop uses
  `desktop-vga-512k`; Advanced uses `advanced-vga-512k`. All stop at 640x480.
- Portable supports 80x25 text, 320x200x8, and 640x480x4 in 256 KiB VRAM on an
  800x480 physical LCD. Both desktops add 640x480x8 in 512 KiB VRAM on a 640x480
  Monitor.
- `DisplayDevice` allocates transient VRAM on POST, releases it at power-off,
  marks dirty tiles in O(1), and drains a fixed-capacity ring in bounded O(D)
  batches.
- The fixed-cell `TerminalBuffer` is the text source of truth. A renderer,
  Resource Pack form, or Web client must never become authoritative terminal
  state.

## Identity

New Computer identities use collision-checked lowercase `c-xxxxxx` Crockford
Base32 payloads encoding the stable 30-bit numeric ID. Do not renumber legacy
`computer-N` identities or accept unsupported payload schemas during migration.
