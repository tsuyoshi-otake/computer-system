# Block storage domain test guidance

- The current suite covers an IDE profile's admission, first/subsequent modeled
  timing, queue/size rejection, write protection, absent media, ejection, and
  stale generation. Named timing profiles use guest nanoseconds.
- Before changing profile geometry or deadline chaining, add explicit 20/40/80
  MiB IDE and 1,474,560-byte FDD geometry, 128/36-sector capacity-plus-one,
  CHS/rotation boundaries, predecessor-deadline chaining, and active/queued
  eject cancellation cases.
- Rejection leaves queue/media/mechanical state unchanged while documented
  rejected/failed statistics advance. This model owns no sector bytes.

## Focused verification

Run `npm test -- tests/domain/storage/blockDevice.test.ts`. Application heap and
host-admission behavior belongs to `tests/application/runtime/`.
