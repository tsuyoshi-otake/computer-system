# Guest I/O application guidance

## Ownership and timing

- Face, serial, I2C, and SPI brokers coordinate deterministic guest devices;
  they do not own Minecraft topology or host transports. Adapters publish
  bounded observations and consume explicit application outcomes.
- Guest wire/device timing is independent from host admission. Deferral may
  delay delivery but must not change the modeled due cycle, transfer count, or
  ordering.
- Preserve stable Computer and face identities across connect, disconnect,
  replacement, reload, and rollback. Stale generations/links fail explicitly.

## Bounded brokers

- Use fixed-capacity byte rings, queues, endpoint indexes, and per-tick delivery
  budgets. Validate packet/transfer length and capacity before mutation.
- RS-232C readiness uses an O(1) deque with exact removal on disconnect. Closing
  either endpoint resolves queued/in-flight ownership without stale ready
  entries, duplicate delivery, or silent data transfer to a replacement link.
- I2C and SPI are bounded synchronous atoms of at most 256 bytes and are charged
  to the guest CPU lane. Until adapters expose explicit resumable/deferred
  outcomes, do not claim their reserved WorkMonitor lanes as separate production
  measurements.
- One transfer has one terminal result: delivered, rejected, disconnected,
  cancelled, timed out, or faulted. Partial delivery must be represented by the
  protocol contract, never inferred from an exception.
- Keep topology lookup and ready-path work Map/deque-backed. Avoid scanning all
  Computers or all links for one ready endpoint.

## Verification

Use `tests/io/` for face identity, byte order, buffer capacity, disconnect,
replacement generations, simultaneous links, I2C/SPI limits, and exact cleanup.
Real-BDS serial acceptance must cover three machines, six faces, 36 ordered
links, and 72 bidirectional Linux ttyS/DOS COM transmissions.
