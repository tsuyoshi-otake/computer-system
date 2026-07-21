# Runtime and CPU test guidance

- This scope owns scheduler/WorkMonitor, CS486 process, instruction/cache/bus
  timing, Python compilation/execution/imports, native modules,
  CS486OBJ/IR/linker/debugger core, and limits.
- Modeled guest cycles and diagnostics are authoritative. Do not use host
  wall-clock thresholds as CPU/language performance assertions.
- Scheduler tests cover runnable-only bookkeeping, fairness, pause/resume,
  cancellation, timeout, shutdown, exactly-once finalization, queue limits, and
  capacity-plus-one without starving admitted work.
- WorkMonitor scale tests make fixed per-tick work and absence of
  whole-population scans observable under large Computer counts. The sibling
  `tests/application/runtime/` scope owns block-I/O admission tests.
- Python tests prove direct CS486 lowering with no second VM/scheduler, shared
  cycle/process accounting, waits/resume, immutable credential propagation,
  bounded imports, module-once, circular/missing/oversized failure, object ABI,
  and CS386SX status 127.
- Package tests prove regular `__init__.py` precedence, parent-before-child
  initialization, dotted/top-level versus alias/leaf binding, absolute and
  explicit-relative selected imports, wildcard exports, metadata, partial
  cycles, rollback/retry, exact graph limits, shared call depth, managed heap,
  and bounded scheduler slices.
- Pattern-matching tests prove evaluate-once subjects, ordered guards, atomic
  capture publication, failed-OR rollback, sequence-star and mapping-rest value
  ownership, inherited `__match_args__`, attribute-miss fallback, catchable
  dynamic contract faults, control-transfer cleanup, and bounded CS486 slices.
- Iterator tests prove that `iter`, `next`, `for`, unpacking, starred displays,
  call expansion, slice replacement, and `set` share one current cursor,
  preserve iterator identity, and terminate exhaustion explicitly. User-
  iterator cases also cover inherited class-only special lookup, separate and
  self iterators, generator-returning `__iter__`, exact defaults/faults,
  comprehension/generator-expression/yield-from consumers, capacity, call- depth
  rollback, and reachable call-marker ownership.
- Sequence-fallback tests cover inherited class-only `__getitem__`, `__iter__`
  precedence and explicit `None`, independent zero-based cursors, position
  retention on faults, sticky exhaustion, every lazy/materializing consumer,
  generator-function items, call-depth, capacity, and heap ownership.
- Callable/sentinel iterator tests cover evaluate-once operands, equality before
  yield, stable sentinel and callable-`StopIteration` exhaustion, other-fault
  recovery, functions/lambdas, bound methods, classes, native waits, CS486
  extensions, every consumer, call-depth rollback, and reachable ownership.
- Generic-materialization tests apply user iterators and generators to starred
  displays, positional call expansion, unpacking, slice replacement, and `set`.
  Cover mixed-source order, current-position retention, no premature
  call/store/mutation/publication, non-stop faults, exact/capacity-plus-one,
  duplicate production, call-depth rollback, physical return ownership, and
  reachable pending state.
- Generator tests prove lazy call, direct-scope classification, independent
  created/suspended/closed state, CS486 `next`/`for`/`send` resumption, exact
  sent-value identity, `throw` injection, `close`/`GeneratorExit`, yield through
  `try`/`except`/`finally`, first-send and all-method re-entry rejection,
  closure/stack/handler/finalizer retention, return exhaustion, fault closure,
  capacity rejection without consumption, and reachable frame/bound-method heap
  ownership.
- Yield-from tests cover evaluate-once and lazy iteration, built-in and
  generator delegates, subgenerator return capture, `send`/`throw`/`close`
  forwarding, missing delegate methods, nested finalizers, re-entry, admission
  rollback, and reachable delegate ownership.
- Generator-expression tests cover immediate leftmost iterator acquisition, lazy
  elements/filters/later iterables, nested evaluation order, non-leaking
  targets, containing-scope `:=`, sole-call-argument syntax, independent
  cursors, the shared generator methods, capacity rollback, and heap
  reachability.
- Context-manager tests cover class special-method acquisition, left-to-right
  entry and right-to-left exit, protected target assignment,
  normal/control/fault arguments, truthy suppression, exact reraising,
  replacement faults, missing or raising methods, generator suspension/close,
  exact/capacity-plus-one call admission, and reachable bound-exit ownership.
- Coroutine tests cover unstarted calls, native and class-backed awaitables,
  synchronous protocol methods returning coroutines, exact values/faults,
  send/throw/close terminal states, async iteration exhaustion and control,
  async-context reverse finalization and suppression, invalid protocols,
  call-depth rollback, reachable frames, and low CS486 instruction slices.
- Async-generator tests cover lazy creation, `__anext__`/`asend`/`athrow`/
  `aclose`, exact async exhaustion, close finalizers, operation reuse,
  asynchronous comprehensions, heap ownership, admission rollback, and low CS486
  slices.
- Exception-group tests cover construction/downcast, recursive shape-preserving
  split, ordered handlers, temporary ordinary-exception wrapping, new/unmatched
  merge, bare reraises, managed callable predicates and faults, generator and
  coroutine suspension, exact/capacity-plus-one bounds, heap roots, and low
  instruction slices.
- Template-string tests cover f/t shared evaluation order, retained read-only
  metadata, intrinsic imports and constructors, conversion, empty-string-
  omitting iteration, Template-only concatenation, pattern matching, invalid and
  exact/plus-one recovery, managed heap ownership, and low CS486 slices.
- Descriptor tests cover inherited data/non-data precedence, class/instance
  access, ordered atomic set-name notification, property accessors,
  static/class-method binding, bound reflection, fault retry, call depth,
  exact/plus-one capacity, heap ownership, and low CS486 slices.
- Super tests cover hidden-cell scope and completion ownership, zero/one/two
  argument validation, C3 continuation, managed descriptor/classmethod/property
  binding, cooperative `object.__init__`, read-only reflection, failed-class
  cell clearing, exact MRO, call depth, heap ownership, and low CS486 slices.
- New-construction tests cover C3 selection, implicit-static plain `__new__`,
  strict `object.__new__`, exact argument forwarding, returned-subclass
  initialization, non-instance returns, nested/fault ownership, call depth,
  pre-publication heap rejection, and low CS486 slices.
- `pythonCs486Harness.ts` is a helper around the production process, not an
  alternate execution engine.
- Toolchain core tests cover v1 read compatibility, v2 sections/relocations,
  typed symbols/signatures, SSA validation/dominance, deterministic capped
  passes, linear-scan spills/frame bounds, corrupt input, and no partial output.

## Focused verification

Annotation tests prove lazy function/class/module evaluation, forward names,
authored ordering, successful caching, fault retry, conditional entry
activation, partial-module non-caching, class namespace and closure access,
function-local non-evaluation, non-simple target behavior, heap ownership, exact
collection capacity, and bounded CS486 slices.

Type-parameter tests prove private annotation scopes, containing-scope defaults
and decorators, stable function/class/alias `__type_params__`, all three
parameter kinds, lazy bound/constraint/default/alias access, success caching,
fault retry without partial publication, closure visibility, and bounded CS486
slices.

Generic-alias tests prove class, type-alias, and built-in collection
subscription; stable origin/argument/open-parameter reflection; open/nested
substitution; lazy defaults and fault retry; one variadic tuple parameter and
normalized explicit `ParamSpec` lists/tuples/expanded arguments; type-erased
construction; runtime-class-check rejection; cache identity, capacity-plus-one,
reachable heap ownership, and bounded CS486 slices.

Typing-runtime tests prove reserved intrinsic resolution with and without a
guest `typing.py`, stable special values/forms, type-parameter constructors,
reflection and identity helpers, runtime non-enforcement, invalid-call recovery,
read-only metadata, exact/capacity-plus-one cache admission, heap ownership, and
low-slice resumption.

Run `npm test -- tests/runtime`. Add
`tests/application/runtime/blockIoScheduler.test.ts` when changing the
WorkMonitor/block-I/O boundary. Use MCP guest execution for any claimed language
or hardware benchmark.
