# Block storage domain guidance

## Profiles

- Portable, Desktop, and Advanced Desktop fixed disks are 20, 40, and 80 MiB.
  IDE timing models controller setup, CHS seek, 3,600 RPM rotation, PIO
  transfer, and write settling.
- The future 1.44 MB / 1,474,560-byte FDD models 80 cylinders, two heads, 18
  sectors per track, 300 RPM, motor spin-up/idle, media generations, write
  protection, ejection, and controller/DMA timing. Production media remains
  absent until an insertion adapter ships.
- Profile geometry, byte capacity, sector size, request limit, and timing values
  are versioned invariants. Construction validates positive integer geometry,
  geometry product, and nonnegative queue depth; named timing profiles are
  trusted inputs and need boundary validation before accepting external data.

## Requests and media

- Validate request ID 1..128, LBA, sector count/profile maximum, media range,
  duplicate ID, queue capacity, media presence, and write protection before
  admission. The operation is a TypeScript union; requests do not carry buffers,
  CHS, or a caller-supplied generation. The device derives CHS and captures the
  current media generation.
- Deadlines use guest nanoseconds. Host admission may defer delivery, but
  `completeOneDue` reports the modeled deadline and starts the next request from
  its predecessor deadline, never host observation time.
- Eject cancels active and queued requests and increments media generation.
  Fixed media starts at generation 1; removable media starts absent.
- Bound queues, request bytes, deadline storage, completion batches, and motor
  state transitions.
- Queue depth excludes the one active request. Maximum request sizes are 128 IDE
  sectors and 36 FDD sectors. The device models timing/state, not sector bytes.

## Verification

Use `tests/domain/storage/blockDevice.test.ts` and runtime block-I/O scheduler
tests. Cover exact disk geometry, first/subsequent access timing, rotational and
seek boundaries, queue/size capacity, duplicate IDs, write protection, absent
media, eject/reinsert cancellation/generations, late delivery with unchanged
modeled deadline, predecessor-deadline chaining, unchanged queue/media /
mechanical state on rejection, and intentional rejected/failed accounting
increments.
