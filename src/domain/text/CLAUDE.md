# Text primitive guidance

- UTF-8 byte length, encoding, and chunk decoding are deterministic and
  independent of host locale or terminal encoding.
- These primitives are O(N), allocate output, and impose no input/output budget;
  every user-facing caller must enforce its own bound before calling them.
- The chunk decoder retains at most a three-byte incomplete suffix. Invalid
  leads/continuations, overlong sequences, surrogates, and out-of-range code
  points emit U+FFFD and advance one input byte once enough bytes arrive. There
  is no final-flush API, so an incomplete suffix remains pending at stream end.
- The encoder does not normalize lone JavaScript surrogates. Scope round-trip
  guarantees to valid Unicode scalar strings, or harden encoder behavior before
  broadening that contract.

## Verification

Use the focused text callers and add direct tests when primitives change. Cover
ASCII, multibyte and supplementary characters, caller-enforced byte limits,
every 1/2/3-byte split point, invalid/overlong/surrogate input, pending
truncated suffix behavior, replacement progress, empty input, valid-scalar round
trips, and the current lone-surrogate behavior.
