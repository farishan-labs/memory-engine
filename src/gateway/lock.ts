import lockfile from "proper-lockfile";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expand } from "./config";

const TIMEOUT_MS = 10_000;

export async function withWriteLock<T>(
  lockPath: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const p = expand(lockPath);
  mkdirSync(dirname(p), { recursive: true });
  // ensure the lock target exists
  const { writeFileSync, existsSync } = await import("node:fs");
  if (!existsSync(p)) writeFileSync(p, "", "utf8");

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(p, {
      stale: 30_000,
      retries: { retries: 20, minTimeout: 100, maxTimeout: 500 },
      realpath: false,
    });
  } catch (e) {
    throw new Error(
      `Could not acquire write lock (${p}): ${(e as Error).message}. ` +
        `Another session may hold it; retry in a moment.`,
    );
  }
  try {
    return await fn();
  } finally {
    if (release) await release();
  }
}

// Read ops in v1 do not take a cross-process shared lock; optmem has its own
// internal locking. This wrapper exists for API symmetry and future use.
export async function withReadLock<T>(fn: () => Promise<T> | T): Promise<T> {
  return await fn();
}