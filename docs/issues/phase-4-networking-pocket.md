# Phase 4: Implement networking and pocket computers

Parent: #1 Blocked by: #5

## Scope

- [ ] Implement Wired Modem and Networking Cable topology with component
      caching.
- [ ] Implement Wireless Modem distance and dimension rules.
- [ ] Implement Ender Modem long-range and cross-dimension rules.
- [ ] Implement `rednet` open, close, send, broadcast, receive, host, and
      lookup.
- [ ] Implement normal and Advanced Pocket Computers.
- [ ] Implement Wireless, Ender, and Noisy Pocket Computer upgrades.
- [ ] Reconcile pocket lifecycle without hidden every-tick inventory scans.
- [ ] Bound delivery queues, topology work, retries, and disconnect cleanup.

## Acceptance rubric

`Verify:` Exercise wired, wireless, Ender, direct, broadcast, filtered, timed
out, cross-dimension, disconnect, duplicate-item, and container-storage cases.

`Expect:` Exactly the eligible computers receive each message, no computer is
starved, timeouts resume callers, and each pocket ID has one observable owner.
