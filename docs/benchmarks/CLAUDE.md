# Benchmark documentation guidance

## Child scopes

| Child scope                                           | Responsibility                                           |
| ----------------------------------------------------- | -------------------------------------------------------- |
| [`strength-reduction/`](strength-reduction/CLAUDE.md) | Cross-language modeled-cost fixture and live-BDS capture |

- Benchmarks execute inside the guest through MCP or the production scheduler.
  Never substitute host Python/compiler/shell/timer results for guest evidence.
- Define algorithm, input, expected checksum, compiler mode, hardware profile,
  cold/warm state, and captured fields before comparing results.
- Treat `cpuCycles`, machine instructions, cache/bus diagnostics, and virtual
  microseconds as modeled guest cost. Label MCP/browser/wall time separately as
  responsiveness.
- Compile time, source creation, relay, browser, network, and Minecraft wall
  delay are excluded unless the benchmark explicitly measures end-to-end
  response.
- Keep raw result artifacts immutable and provenance-dated. A rerun creates a
  new result file; do not silently overwrite historical evidence or merge
  host-only and real-BDS rows.
- Sequential success is not multi-user capacity. Load evidence requires bounded
  concurrency, tick percentiles/max, response latency, capacity-plus-one
  rejection, logs, and interaction responsiveness.

## Verification

Follow `tools/CLAUDE.md` for MCP execution and inspect new logs after every
stage. All supported cells must match the expected checksum; an
unsupported-hardware status is recorded as compatibility evidence, not a timing
result.
