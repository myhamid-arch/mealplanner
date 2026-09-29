// The staleness rule shared by the verify scripts' mkdir locks (W-21).
//
// A lock is a directory made with an atomic mkdir, and its holder writes its pid into `pid`
// straight after. A holder killed between the two leaves a lock with no pid, or an empty one.
// Such a lock has no holder that could ever release it, so it counts as stale once it is older
// than that mkdir-to-write window, just like a lock whose recorded holder is dead.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** How long a lock may exist without a recorded holder: far longer than mkdir-then-write. */
export const UNRECORDED_GRACE_MS = 5_000;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error.code === "EPERM";
  }
}

/**
 * Whether the lock directory `lock` may be taken over: its recorded holder is dead, or it
 * records no holder and is older than {@link UNRECORDED_GRACE_MS}. A lock that no longer
 * exists is not stale; the caller simply retries its mkdir.
 */
export function lockIsStale(lock, now = Date.now()) {
  let text = null;
  try {
    text = readFileSync(join(lock, "pid"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const pid = text === null ? NaN : Number(text.trim());
  if (text !== null && text.trim() !== "" && Number.isInteger(pid) && pid > 0) return !alive(pid);
  try {
    return now - statSync(lock).mtimeMs > UNRECORDED_GRACE_MS;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
