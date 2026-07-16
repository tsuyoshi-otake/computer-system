# Block-I/O application test guidance

- `blockIoScheduler.test.ts` owns host admission and delivery around domain
  block devices. Domain geometry/mechanical timing belongs to
  `tests/domain/storage`.
- Preserve guest-nanosecond deadlines when host work is deferred. Due work stays
  in one bounded heap; idle devices are not polled and host observation time
  does not rewrite modeled completion order.
- The current suite covers host deferral, due delivery, byte/completion caps,
  idle-device non-polling, unknown-device rejection, and request-limit
  rejection. Before changing registration/replacement, ejection/generation,
  cancellation, or detach behavior, add explicit cases here and prove one
  completion/failure owner per admitted request.
- Assert bounded operations rather than host elapsed thresholds.

## Focused verification

Run `npm test -- tests/application/runtime/blockIoScheduler.test.ts` together
with the owning domain and WorkMonitor suites when their boundary changes.
