declare module "proper-lockfile" {
  export interface LockOptions {
    stale?: number;
    retries?: { retries: number; minTimeout?: number; maxTimeout?: number };
    realpath?: boolean;
  }
  export function lock(path: string, options?: LockOptions): Promise<() => Promise<void>>;
  export function unlock(path: string, options?: LockOptions): Promise<void>;
  export function check(path: string, options?: LockOptions): Promise<boolean>;
}