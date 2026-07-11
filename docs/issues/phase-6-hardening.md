# Phase 6: Add command computers, hidden content, and release hardening

Parent: #1
Blocked by: #7

## Scope

- [ ] Implement administrator-only Command Computer acquisition and execution.
- [ ] Add command allowlists, audit records, argument validation, and rate limits.
- [ ] Add Treasure Disks and independently authored secret programs.
- [ ] Add Developer Computer, Debug Turtle, and Unknown Peripheral acquisition rules.
- [ ] Add migration and corrupted-storage recovery tooling.
- [ ] Run multiplayer, reload, long-duration, and low-budget load tests.
- [ ] Complete original textures, models, audio, documentation, and attribution.
- [ ] Add the independent-project and unofficial-Minecraft disclaimers.
- [ ] Review third-party dependencies and select a license for original project code.
- [ ] Produce release `.mcpack` or `.mcaddon` artifacts and installation documentation.

## Acceptance rubric

`Verify:` Run all automated checks, the full Bedrock compatibility suite,
permission-abuse tests, migration and recovery tests, and a long-duration
multiplayer soak test; then install the release artifact in a clean world.

`Expect:` All checks pass, privileged behavior is gated and audited, persistent
data survives supported upgrades, licenses and disclaimers are complete, and
the release artifact installs and runs without development files.
