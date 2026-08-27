/**
 * An error caused by repository configuration or pull request metadata rather
 * than by a policy violation. Reported separately so the failure message can
 * tell the author what to fix.
 */
export class UsageError extends Error {
  override readonly name = "UsageError";
}
