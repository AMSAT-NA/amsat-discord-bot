/**
 * Shared runtime state.
 * Initialised once when the module is first imported and never mutated after that.
 */

/** UTC timestamp of when this process started */
export const startTime = new Date();

/**
 * Git commit SHA baked in at Docker build time via the COMMIT_SHA build arg.
 * Falls back to 'development' when running locally without the build arg set.
 */
export const commitSha: string = process.env.COMMIT_SHA ?? 'development';

/** Short (7-char) version of the commit SHA for display */
export const shortSha: string =
  commitSha === 'development' ? 'development' : commitSha.slice(0, 7);

/** Human-readable uptime string, e.g. "2d 4h 31m" */
export function formatUptime(): string {
  const ms      = Date.now() - startTime.getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours   = Math.floor(minutes / 60);
  const days    = Math.floor(hours / 24);

  if (days > 0)    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0)   return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
