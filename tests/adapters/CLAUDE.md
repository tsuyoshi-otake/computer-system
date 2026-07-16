# Adapter test guidance

- This scope verifies concrete outward repositories against their application
  ports. Read the matching `src/adapters/` guidance and treat serialized
  payloads as untrusted input.
- The current direct suite covers per-Computer paging/restore, generation
  isolation, invalid serialized values, and unsupported display profiles.
- Previous-generation fallback, checksums, readback-failure injection, and page
  rollback belong to `tests/phase0/transactionalPagedStore.test.ts`; application
  activation and migration failure ownership belong to `tests/computer/`.
- Keep provider operations and fixtures bounded. A host fake must preserve the
  operation ordering and failure semantics of the production boundary.

## Focused verification

Run `npm test -- tests/adapters`. Before expanding repository behavior, add the
malformed/provider-failure case to this direct suite and the owning paged-store
or migration suite rather than claiming cross-scope coverage here.
