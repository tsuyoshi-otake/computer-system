let rejectedAsyncTransactionCountValue = 0;

/**
 * Returns the process-local quarantine generation shared by managed guest
 * transaction owners. A nonzero value means an async callback that was rejected
 * by a synchronous transaction has not settled yet.
 */
export function rejectedAsyncTransactionCount(): number {
  return rejectedAsyncTransactionCountValue;
}

/**
 * Quarantines every managed filesystem and DOS aggregate until the rejected
 * thenable settles. This preserves the synchronous cross-owner boundary after
 * the callback stack has unwound and its continuation resumes.
 */
export function quarantineRejectedAsyncTransaction(
  value: PromiseLike<unknown>,
): void {
  rejectedAsyncTransactionCountValue += 1;
  const release = (): void => {
    rejectedAsyncTransactionCountValue -= 1;
  };
  void Promise.resolve(value).then(release, release);
}
