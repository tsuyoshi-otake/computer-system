# Guest I/O test guidance

- Prove byte order, ring wrap/exact capacity, concurrent links, ready-deque
  exact removal, disconnect/reconnect, endpoint replacement generation, stale
  work rejection, and one terminal result per transfer.
- Guest wire/device timing is independent from host admission delay. Tests use
  modeled deadlines/cycles, not host sleeps or fragile elapsed thresholds.
- I2C covers addresses `0x08..0x77` and the 256-byte combined write/read limit.
  SPI covers fixed mode 0 and chip selects 0..7. Both prove synchronous atomic
  behavior, defensive array copies, device rejection, and 0/256/257-byte
  boundaries.
- Serial matrix host tests validate topology/order; they do not replace the
  isolated real-BDS transmission matrix.

## Focused verification

Run `npm test -- tests/io`. Real acceptance uses `npm run test:mcp:serial:bds`
with a dedicated workdir/free ports and requires three machines, six faces, 36
ordered links, and 72 bidirectional ttyS/COM transmissions before owned-server
cleanup.
