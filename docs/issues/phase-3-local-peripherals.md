# Phase 3: Implement redstone and local peripherals

Parent: #1 Blocked by: #4

## Scope

- [ ] Implement the Peripheral Bus and attach/detach events.
- [x] Add the bounded six-face RS-232C, SPI, and I2C controller foundations,
      fixed Linux/DOS device numbering, and machine-relative topology mapping.
- [ ] Implement the Redstone Interface and independent analog output fallback.
- [ ] Implement Disk Drive, Floppy Disk, and `/disk`, `/disk2` mount behavior.
- [ ] Implement Monitor and Advanced Monitor using the validated rendering
      adapter.
- [ ] Implement Speaker notes and registered sounds within validated limits.
- [ ] Implement Printer, Printed Page, Printed Pages, and Printed Book.
- [ ] Implement `peripheral`, `disk`, `colors`, and relevant terminal APIs.

## Acceptance rubric

`Verify:` Attach and detach every peripheral, mount multiple disks, render and
interact with a connected monitor, play notes, print and reopen a multipage
document, and produce independent analog output through two interfaces.

`Expect:` Events are delivered once, resources remain bounded, saved media
survives reload, and unsupported behavior returns an explicit error.
