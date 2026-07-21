# Issue #71 — build portability evidence

## Scope and status

Issue [#71](https://github.com/tsuyoshi-otake/computer-system/issues/71) adds
the bounded static-library, compiler-driver, dependency-generation,
preprocessor, and Make surface used by conventional multi-file CS-Linux C ports.
The implementation, host acceptance fixture, real-BDS probe, and complete
repository gate pass. The Issue's acceptance contract is complete.

Issue #64 and further NetHack game implementation are explicitly excluded. The
preserved prototype may rebuild against shared toolchain changes, but it is not
an implementation target or part of this Issue's completion percentage.

## Implemented contract

- `CS486AR` version 1 stores validated CS486OBJ v1-v3 members in canonical name
  order with SHA-256 member digests, one canonical global-symbol index, shared
  ABI/data-model identities, an archive checksum, and a bounded deterministic
  LZW wire encoding. Readers also accept the original uncompressed JSON form.
- Guest `ar` supports create/replace/index (`r`, `rcs`), delete (`d`), list
  (`t`), and transactional extract (`x`). `ranlib` deterministically refreshes
  the index. Every mutation validates a complete trial archive before one
  filesystem transaction replaces the destination.
- `ld`, `cc`, and `c++` search at most 16 credentialed guest `-L` directories
  plus `/usr/lib` for `.csa` files. Archive selection preserves operand order,
  uses Map-backed unresolved-symbol/member indexes, extracts only demanded
  members, and exposes selected-member/index-lookup work. It never invokes or
  recognizes a host archive, ELF library, native linker, or dynamic loader.
- Rootfs v17 installs deterministic `/usr/lib/libc.csa` and
  `/usr/lib/libcurses.csa`. The linker may prune unreferenced functions only
  from large objects whose assembly evidence is explicitly marked truncated;
  ordinary full-transcript objects retain exact canonical linker evidence.
- The driver accepts the documented C11/C++11, `-O0`/`-O1`, `-g`, `-Wall`,
  `-Werror`, `-I`, `-D`, `-U`, `-c`, `-o`, `-L`, `-l`, `-MMD`, and `-MF`
  surface. Other optimization, standard, and warning options fail explicitly.
  Dependency and object files are installed together in one transaction only
  after successful compilation.
- The C preprocessor provides reproducible profile built-ins, dynamic
  `__FILE__`/`__LINE__`, frontend-owned `__func__`, variadic macros and
  `__VA_ARGS__`, include-identity `#pragma once`, and provenance-preserving
  `#line`. Include, expansion, source, token, and diagnostic limits remain
  explicit. Live host `__DATE__` and `__TIME__` are not injected.
- CS Make adds indexed pattern candidates, `$*`, bounded required/optional
  Makefile includes, `ifeq`/`ifneq`/`ifdef`/`ifndef` with `else`/`endif`, and
  dependency-only rule merging for generated `.d` files. The initial target
  commit reparses available dependency includes so the next identical build is a
  no-op instead of a one-time convergence rebuild.
- Make planning exposes pattern-candidate and traversed-edge counts. One recipe
  continuation remains the unit of progress. WorkMonitor lane capacity is
  checked before queue removal, so an inadmissible next build retains its fair
  queue position and cannot starve alternating Computers.

## Deliberate limits and exclusions

- One archive contains at most 128 members and 8,192 indexed symbols and has an
  8 MiB encoded ceiling. One Make parse has an aggregate 32,768-character,
  256-line, 64-include, depth-8 include budget, 128 rules/patterns, 256 graph
  nodes, 512 edges, 64 prerequisites per rule, and 256 recipe lines.
- Pattern rules contain exactly one `%` in a target and at most one per
  prerequisite. Authored candidate order is deterministic and candidates are
  indexed by target suffix; there is no repeated all-pattern/all-file scan on a
  scheduler tick.
- There is no dynamic linking, link group, weak symbol, constructor, visibility,
  GNU Make function/eval, recursive Make, parallel Make, arbitrary configure
  shell, pipeline, redirect, background recipe, or host fallback. Checked-in or
  pre-generated `config.h` is the official configuration boundary.

## Official guest port workflow

Keep a project-owned `config.h`, emit one `.d` file beside each object, and use
two-stage archive/link recipes. For example:

```make
CC = cc
CFLAGS = -std=c11 -O1 -Wall -Werror -Iinclude
OBJECTS = main.o parser.o render.o
DEPS = main.d parser.d render.d

app: main.o libport.csa
	ld main.o -L. -lport -o $@

libport.csa: parser.o render.o
	ar rcs $@ $^
	ranlib $@

-include $(DEPS)

%.o: %.c
	$(CC) $(CFLAGS) -MMD -MF $*.d -c $< -o $@
```

Use checked-in Make conditions only for bounded profile selection. Do not run
Autoconf, CMake, a native `configure`, or a host compiler.

## Verification rubric

### Archive, driver, preprocessor, and rollback

Verify:

```powershell
rtk npm run test -- --run tests/runtime/cs486Archive.test.ts tests/runtime/cs486CPreprocessor.test.ts tests/os/staticArchiveToolchain.test.ts
```

Expect: canonical round trips, demand extraction and ordering, member/encoding
capacity-plus-one, corrupt/duplicate rejection, `ar`/`ranlib`, `-L`/`-l`, atomic
`.d` publication, retained prior outputs on compile/write failure,
supported/unsupported flags, variadic macros, source built-ins, pragma-once, and
line provenance all pass.

### Make scale, incremental correctness, and reproducibility

Verify:

```powershell
rtk npm run test -- --run tests/runtime/guestMake.test.ts tests/os/makeCommand.test.ts
```

Expect: the 24-translation-unit fixture builds two archives and one runnable
executable entirely through guest commands; its immediate second build is a
no-op; a shared-header change rebuilds exactly 24 dependent objects, both
archives, and the executable but not `main.o`; a clean rebuild is
byte-identical. Include cycles, conditional finalization, indexed 128-candidate
pattern lookup, and rule capacity-plus-one terminate explicitly.

### Scheduler and WorkMonitor fairness

Verify:

```powershell
rtk npm run test -- --run tests/computer/compileJobPlan.test.ts tests/runtime/computerWorkMonitor.test.ts tests/runtime/workMonitorScale.test.ts
```

Expect: four concurrent guest archive builds complete on consecutive fair ticks,
guest compile admission has no avoidable deferral, guest CPU continues to
receive work, and existing fixed-batch/scale invariants pass.

### External and repository gates

Verify: run `rtk npm run test:mcp:bds` and `rtk npm run validate`.

Expect: the BDS probe and guest build finish with zero diagnostics, and
formatting, lint, TypeScript, all tests, pack build, and 16-chapter Pages build
pass.

Result on 2026-07-20: PASS. The isolated real-BDS suite completed
authentication, Make, and Git probes in 39.8 seconds with zero failures, zero
diagnostics, and final state `idle`. The complete repository gate passed 275
Vitest files / 2,066 tests, the hosted-C archive check, production pack build,
and all 16 Pages chapters. A live Chrome build/run was not added to the GitHub
Issue #71 acceptance contract and is not claimed here.
