# CS486DX2 language comparison

Every fixture computes and validates the same 32-bit checksum for `i = 1..1500`:

```text
sum(i*i + 3*i + 7) = 1129513000
```

The 2026-07-31 capture ran each program three times on an isolated real BDS
through MCP, using a CS486DX2 at 66 MHz. Source upload, compilation, relay,
Minecraft delay, and host wall time are excluded. Every run exited 0, produced
no guest output after its internal checksum check, and returned the same cycle
count in all three repetitions. The isolated server reported no diagnostics and
was stopped after capture.

| Rank | Language | Instructions | CPU cycles | Virtual us | ASM ratio |
| ---: | -------- | -----------: | ---------: | ---------: | --------: |
|    1 | ASM      |       15,005 |     42,099 |    637.864 |     1.000 |
|    2 | C        |      151,584 |    323,837 |  4,906.621 |     7.692 |
|    2 | C++      |      151,584 |    323,837 |  4,906.621 |     7.692 |
|    4 | Python   |       52,534 |    893,439 | 13,536.955 |    21.222 |
|    5 | Perl     |            - |  1,052,332 | 15,944.424 |    24.997 |

Python and Perl now use one shared deterministic managed-runtime tariff after
each real CS486 syscall instruction: dispatch, type checks, loads, stores,
iterator acquisition/steps, collection elements, and string traversal. Numeric
work keeps the 486-class ordering add/compare < multiply < divide < power.
Python arbitrary-precision integers additionally scale by 30-bit limb count;
Perl uses its documented scalar-double representation. These are guest-runtime
instruction-equivalent costs, not host wall time and not a claim to reproduce
upstream CPython or perl internals cycle-for-cycle.

The Python and Perl fixtures use the same explicit `term` assignment as C and
C++. Their three real-BDS runs returned exactly 893,439 and 1,052,332 cycles,
respectively. A second 100-iteration workload also retained the ordering (Python
23,119; Perl 36,161), without a benchmark-specific multiplier. Earlier models
are retained only as superseded provenance in the JSON. Perl does not yet expose
a guest `--stats` switch, so its instruction column remains blank.

Exact repeated values and provenance are retained in
[`results-2026-07-31.json`](./results-2026-07-31.json).
