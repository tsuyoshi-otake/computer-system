# I/O domain guidance

## Bounded primitives

- Byte rings and device queues have fixed capacities. Validate requested
  transfer size and free space before mutation; capacity-plus-one fails with
  unchanged head/tail/count and no partial packet.
- Preserve byte order exactly and make wraparound deterministic. Avoid shifting
  arrays or scanning all endpoints on the ready path.

## RS-232C, I2C, and SPI

- RS-232C models powered port state with bounded buffers/transfers, not topology
  or host serial hardware. Power/reset advances its epoch, clears buffers, and
  retains explicit dropped-byte counts; callers must bound the free-form reset
  reason. Connect/disconnect and replacement generations belong to the
  application broker.
- RS-232C defaults to 4,096-byte RX/TX rings, 1,024 bytes per write, and 9,600
  baud with ten wire bits per byte.
- I2C/SPI transfers are synchronous guest atoms of at most 256 bytes and copy
  all caller/device arrays across the boundary. I2C addresses are `0x08..0x77`
  and the combined write/read request is capped at 256 bytes. SPI is fixed mode
  0 at 1 MHz, 8-bit, MSB-first with chip selects 0..7; I2C defaults to 100 kHz.
- Domain buses do not consult BDS ticks or host time. Application brokers own
  topology/readiness; runtime owns CPU-lane accounting and admission.
- One request has one terminal outcome. If a protocol supports partial transfer,
  represent the exact count in the result rather than inferring it from an
  error.

## Verification

Use `tests/io/rs232Port.test.ts` and `tests/io/peripheralProtocols.test.ts`.
Cover byte order, ring wrap, exact capacity, overflow/drop counts, power/reset
epochs, 0/256/257-byte protocol boundaries, I2C address and SPI chip-select
limits, defensive copies, device rejection, and unchanged state after invalid
input. Broker generation/reconnect behavior belongs to
`tests/io/serialLinkBroker.test.ts`.
