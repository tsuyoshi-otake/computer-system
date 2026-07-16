# Strength-reduction language benchmark

Every source computes this 32-bit checksum for `i = 1..1500`:

```text
sum(i*i + 3*i + 7) = 1129513000
```

The baseline evaluates two multiplications per iteration. The optimized variant
uses `term(1) = 11`, `delta(1) = 6`, then increments `term` by `delta` and
`delta` by 2. It preserves the 1,500-iteration loop and output while replacing
the dominant repeated multiplication with additions.

Compile time, file creation, browser/network delay, and Minecraft wall time are
outside the measurement. Record `run --stats` or Python MCP machine
instructions, modeled CPU cycles, and virtual microseconds from a cold process.

The captured live-BDS/MCP result set is
[`results-2026-07-15.json`](./results-2026-07-15.json). Every supported cell
printed `1129513000`; CS386SX rejected both Python variants with status 127.

This capture predates the dedicated C/C++ tokenizer, typed AST, CSIR optimizer,
and register allocator. Its C and C++ rows are historical provenance, not
current compiler measurements. Rerun both variants cold on all three hardware
profiles before publishing new C/C++ comparisons; do not combine new host-only
results with the retained live-BDS table.
