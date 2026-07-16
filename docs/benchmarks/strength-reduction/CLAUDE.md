# Strength-reduction fixture guidance

- Every baseline and optimized source computes the same 32-bit checksum for
  `i = 1..1500`: `1129513000`.
- Baseline performs two multiplications per iteration. Optimized starts with
  `term(1)=11`, `delta(1)=6`, increments term by delta and delta by 2, preserves
  the 1,500-iteration loop/output, and replaces repeated multiplication with
  additions.
- Keep ASM, BASIC, C, C++, and Python semantically equivalent and explicit
  enough for the guest compilers. Do not optimize only one language beyond the
  stated transformation when publishing a cross-language comparison.
- Run both variants cold on all three profiles with the same toolchain mode.
  CS386SX Python status 127 is expected incompatibility and has no cycle result.
- `results-2026-07-15.json` is immutable historical live-BDS/MCP provenance. It
  predates the dedicated C/C++ tokenizer, typed AST, CSIR optimizer, and
  register allocator; its C/C++ rows are not current compiler measurements.
- New measurements use a new dated JSON artifact and document commit, profile,
  sources, stdout/checksum, stderr, exit code, instructions, cycles, cache/bus
  diagnostics, and virtual time. Never combine new host-only rows with this
  table.

## Verification

Compile and run through exact guest Computers via MCP, require the checksum in
every supported cell, inspect logs, and compare baseline/optimized modeled costs
without including compile/relay/Minecraft wall time.
