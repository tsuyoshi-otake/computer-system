# Guest runtime guidance

## Scheduler and host admission

- Guest CPU/device time is deterministic modeled time. Host elapsed time is only
  for admission/observability; never convert it into guest or wire timing.
- `ComputerWorkMonitor` owns one host-time scope per BDS tick and fixed bounded
  CPU, compile, MCP, I/O, bus, redstone, topology, terminal, and persistence
  lanes.
- Normal `run`, MCP CS486, and Python execution are resumable scheduler jobs
  with fixed machine-instruction ceilings. A timeout, status 124, yielded job,
  or incomplete process is not a language-performance result.
- Admit native shell/terminal work before it executes. Do not apply a budget
  check after side effects and turn success into an uncaught host-budget
  failure.
- Keep runnable-only bookkeeping O(runnable), dedupe in-flight work, cap queues
  and concurrency, and finalize cancellation, timeout, process exit, machine
  shutdown, and scheduler disposal exactly once.

## Block and peripheral I/O

- The `block_io` lane admits only due HDD/FDD completions from one bounded
  deadline heap; never poll idle devices. WorkMonitor may defer a due completion
  but may not rewrite its guest deadline.
- Bound request size, queue depth, deadline storage, and completions delivered
  per tick. Disconnect/eject/generation changes must remove or explicitly fail
  stale requests without leaking completion ownership.
- The I/O application owns serial/I2C/SPI protocol and cleanup semantics. This
  runtime only admits their outcomes and accounts the selected WorkMonitor lane.

## Computer System Python

- Parse Python directly to CS486 control flow plus the allowlisted `python`
  syscall ABI in `pythonCs486.ts`. Calls, returns, branches, waits, instruction
  accounting, and cycle debt belong to `Cs486Process`; never reintroduce a
  Python instruction pointer, bytecode VM, or second scheduler.
- Conditional expressions patch ordinary CS486 branches and evaluate exactly one
  result arm. Lambdas reuse compiled-function descriptors, existing call/return,
  argument binding, closure cells, call-depth, and reachable heap accounting.
- Assignment expressions copy one evaluated managed-stack value, store one copy
  through the selected lexical binding, and leave the same value as the result.
  They do not introduce a separate expression evaluator or binding path.
- Assertions use an ordinary CS486 success branch. Evaluate the optional message
  only on failure, then raise `AssertionError` through the existing exception
  and finalizer owner. The current profile has no optimization mode that removes
  it.
- Eager list/set/dictionary comprehensions compile as managed functions.
  Evaluate the leftmost iterable in the enclosing scope, keep targets and later
  clauses in the implicit scope, and route `:=` stores to the containing
  non-comprehension binding. Set growth uses bounded canonical primitive/tuple
  keys and O(1) average lookup without promising Python-portable iteration
  order.
- Class suites use dedicated managed frames and publish only after success. Keep
  class locals out of method closures, pass enclosing cells through, retain one
  canonical C3 MRO, and cap it at 64 including `object` so lookup stays O(M).
- A function or lambda that references `__class__` or builtin `super` captures
  the class frame's separate hidden cell. Initialize it after C3 and heap
  admission but before `__set_name__`; clear it if set-name completion rejects.
  Bound super lookup starts after its named class in the receiver C3 MRO and
  reuses ordinary descriptor binding. Keep proxy state and cells heap-accounted.
- Class construction resolves `__new__` through C3; plain definitions are
  implicit-static and receive class plus original arguments once. Strict
  `object.__new__(cls)` allocates; after-call ownership initializes only
  requested/subclass results through returned-type `__init__` (`None` required)
  and returns others unchanged. Descriptors/set-name and methods share bounded
  call/heap/rollback/fault/slice ownership without partial publication.
- Evaluate decorator expressions in the containing frame before function
  defaults or class bases/suites. Keep them rooted on the managed stack, apply
  them bottom-to-top through ordinary one-argument calls, and use the atomic
  definition store only after every call succeeds.
- Built-in iteration has one cursor protocol shared by `iter`, `next`, `for`,
  unpacking, starred displays, iterable call expansion, slice replacement, and
  `set`. Existing iterators retain identity and current position; exhaustion is
  stable and becomes `StopIteration` only at the `next` API boundary.
- User iteration resolves `__iter__` and `__next__` only through the class C3
  path, invokes them through ordinary bounded Python calls, and retains the
  receiver/default in call-marker heap roots. `StopIteration` has one
  caller-side owner for `for`, `next`, and `yield from`; physical stack, frame,
  handler, fault, and pending-control rollback must remain synchronized.
- If class-backed `__iter__` is absent, class-backed `__getitem__` owns one
  retained zero-based sequence cursor. An explicit `__iter__`, including `None`,
  disables fallback. Increment only after success; make `IndexError` or
  `StopIteration` sticky exhaustion; keep another fault at the same index. The
  cursor roots its source and reuses the managed CS486 call/return path.
- Two-argument `iter(callable, sentinel)` evaluates both operands once and owns
  them in one internal class-backed iterator. Invoke managed functions, bound
  methods, classes, native waits, and extensions only through the ordinary
  bounded call path. Consume an equal sentinel result before publication and
  make it or callable-raised `StopIteration` sticky exhaustion; another fault
  leaves the iterator live. Do not expose the internal class or add a host loop.
- Materializing iteration uses that same path for starred displays, positional
  call expansion, unpacking, slice replacement, and `set`. Retain the iterator,
  accumulated values, pending operands/arguments/targets, and original physical
  return slot in one reachable continuation. Do not invoke a callee, store an
  unpack target, mutate a slice, or publish a result before iteration and
  arity/capacity validation complete.
- Generator functions bind arguments lazily, then resume only through ordinary
  CS486 calls from `next`, `for`, `send`, `throw`, or `close`. A yield saves the
  managed frame, stack suffix, next target, active handlers/faults, and pending
  control/finally continuation before returning. Resume supplies `None`, the
  exact sent managed value, or an injected fault at the suspended yield. Reject
  a non-`None` first send before changing created state. `close` injects
  `GeneratorExit`; return, ignored close, or an escaping fault owns exact
  closure. Suspended children and bound `send`/`throw`/`close` receivers remain
  heap roots. Do not add a Python scheduler or a second instruction pointer.
- `yield from` evaluates one delegate once and keeps that iterator on the
  suspending generator's managed stack. Built-in iterators advance locally; user
  iterators use managed `__next__` calls and preserve `StopIteration.value`;
  generator delegates resume through nested ordinary CS486 calls and forward
  `send`, `throw`, and `close`. Remove the delegate exactly once on exhaustion,
  preserve its return value, and route every fault through the outer handler and
  finalizer owner.
- A synchronous generator expression is a generator-class comprehension frame.
  Evaluate its leftmost iterable and acquire its iterator in the enclosing frame
  before publishing the generator; run elements, filters, and later iterables
  lazily. Reuse the same `next`/`send`/`throw`/`close`, call-depth, suspension,
  and reachable-heap paths as an authored generator function.
- A synchronous `with` item resolves class-backed `__enter__` and `__exit__`,
  retains the bound exit before entering, and installs the assignment/body
  handler only after enter succeeds. Nest multiple items so entry is left to
  right and every normal, fault, return, break, continue, or generator-close
  path exits exactly once in reverse order. Preserve exact fault values and
  preflight the implicit receiver plus three explicit exit arguments before
  entry; retained exits are managed heap roots.
- Assignment, unpacking, and slicing preserve authored evaluation and mutation
  order. Evaluate one RHS before left-to-right stores; never reevaluate an
  augmented target. Check expanded sizes incrementally, account starred
  remainders, normalize slice bounds in O(selected length), and preflight slice
  arity/final capacity so rejection leaves the target unchanged.
- Template strings reuse formatted-field lowering but build retained intrinsic
  `Template`/`Interpolation` values instead of formatted text. Keep nested-field
  order, authored metadata, constructors, iteration, concatenation, heap,
  collection/string limits, and CS486 slice ownership on existing paths.
- Require a hardware profile with MicroPython enabled. CS386SX returns 127.
  Python uses the same timing unit, process lifecycle, memory limits, and cycle
  statistics as ASM, CS QBASIC, C, and C++.
- Module lookup is deterministic and bounded: importer directory, `/lib/python`,
  then `/usr/lib/computer-system/python`. Regular packages require
  `__init__.py`, initialize parents before children, publish children on their
  parent, and retain exact partially initialized namespaces for ordinary cycles.
  Roll an escaping initialization fault back so retry is possible. Reject
  missing names, namespace/zip/dynamic import mechanisms, oversized graphs, or
  excessive depth explicitly and keep resolution O(source + modules).
- Structural matching evaluates one subject once and runs cases in authored
  order. A pattern operation must keep failed captures private, atomically
  preflight and publish a complete success before its guard, retain successful
  bindings across a false/faulting guard, and remove the retained subject before
  any matched body can return, break, continue, or fall through. Keep pattern
  work bounded and charge it to the ordinary CS486 syscall cycle debt.
- Imported `.o` modules must be valid versioned `CS486OBJ` files and expose only
  the current zero-argument EAX-return ABI. Charge extension instructions to the
  same process.
- Deferred annotations compile to ordinary managed CS486 functions. Record only
  executed module/class entries, evaluate on first `__annotations__` access,
  cache only a successful completed owner, and retry after faults. Partially
  initialized modules return fresh executed-so-far dictionaries. Function-local
  annotations never evaluate. Keep annotation closures, class locals, active
  entry sets, and cached dictionaries reachable through heap accounting.
- Type-parameter scopes use managed function frames. Keep decorators/defaults in
  the containing scope and retain parameters for annotations, generic class
  bodies/bases, and lazy aliases. Cache only successful bounds, constraints,
  defaults, and aliases; account their closures, objects, tuples, and roots.
- Generic subscription stays type-erased in one process-local bounded cache.
  Account origins, arguments, parameters, defaults, `ParamSpec` tuples, and
  substitutions. Parameterized construction uses ordinary CS486 calls; reject
  aliases in runtime class checks and never add enforcement or another
  evaluator.
- Keep the bounded `typing` core intrinsic so core, production, and MCP share
  one sandboxed namespace without host Python. Reserve it before guest lookup so
  `/typing.py` cannot shadow it. Reflection is read-only where Python requires;
  reuse the generic cache, heap, limits, faults, and CS486 slice ownership.
  Typing helpers never enforce annotations.
- Coroutines and async generators bind accounted frames without executing.
  Await, async iteration/context, and single-use `__anext__`/`asend`/`athrow`/
  `aclose` use existing CS486 calls. Async comprehensions reuse implicit
  functions, with eager forms as coroutines and generator forms remaining lazy.
  Restore physical returns and finalize every result, fault, exhaustion, close,
  or rejection once; add no event loop or second scheduler.
- Exception groups use one bounded managed tree. `except*` splits in source
  order, preserves bare-reraised identity, and merges unmatched/new faults
  before the existing finalizer. Keep predicates, suspension state, and
  subgroups in CS486 calls/slices and reachable heap; never add another
  exception interpreter.
- The native `shell` module belongs only to empty `/startup.py`; reject access
  from user startup, foreground, filesystem-extension, and MCP Python.
- Carry the immutable process credential snapshot into every Python guest
  filesystem operation; no import, extension, syscall, wait, or resume may widen
  it.

## Modeled statistics

- `run --stats` and Python statistics are authoritative guest cost; synchronize
  instruction, cache, bus, unaligned-access, pipeline, and cycle counters.
- Host benchmark sequencing, concurrency, tick percentiles, capacity probes, and
  interaction evidence belong to `tools/` and `docs/benchmarks/`.

## Verification

Use `tests/runtime/` for runtime behavior/limits and the block-I/O scheduler
test; use `tools/CLAUDE.md` for real-BDS verification.
