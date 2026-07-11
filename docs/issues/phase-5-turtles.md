# Phase 5: Implement turtles and upgrades

Parent: #1
Blocked by: #6

## Scope

- [ ] Implement Turtle and Advanced Turtle device records and terminal access.
- [ ] Implement transactional forward, back, up, down, and turning operations.
- [ ] Implement inspect, detect, dig, place, attack, suck, and drop.
- [ ] Implement 16-slot inventory, adjacent-container transfers, and fuel.
- [ ] Implement left and right upgrade slots.
- [ ] Implement mining, melee, digging, felling, farming, wireless, Ender, noisy, and crafty upgrades.
- [ ] Implement representative preconfigured turtle items and recipes.
- [ ] Define recovery ownership for block, entity, inventory, and chunk failures.

## Acceptance rubric

`Verify:` Run navigation, mining, farming, combat, crafting, networking, audio,
inventory transfer, unloaded-chunk, and two-turtles-one-destination scenarios,
including forced intermediate failures.

`Expect:` At most one conflicting transaction commits, all callers receive a
result, and no block, item, fuel, filesystem, or turtle identity is duplicated
or lost.
