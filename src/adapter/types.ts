// Adapter contract for the memory gateway (Phase 0).
// See SPEC.md §5. Keep in sync with adapters/README.md.

export type AdapterConfig = Record<string, unknown>;

export interface AdapterMeta {
  name: string;
  version: string;
  capabilities: string[];
  dataLocation: string;
}

export interface Memory {
  id: string;
  text: string;
  createdAt: string; // ISO date
  machine?: string;
  tags?: string[];
}

export interface WakeResult {
  parts: string[];
  total: number;
}

export interface ZoomResult {
  lines: string[];
}

export interface ImportReport {
  imported: number;
  skipped: number;
  firstId?: string;
  lastId?: string;
}

export interface SyncStatus {
  dirty: boolean;
  ahead: number;
  behind: number;
  branch?: string;
}

export const ErrUnsupported = new Error("ErrUnsupported");
export const ErrNotFound = new Error("ErrNotFound");
export const ErrConflict = new Error("ErrConflict");
export const ErrSecretDetected = new Error("ErrSecretDetected");

export interface Adapter {
  init(cfg: AdapterConfig, signal?: AbortSignal): Promise<void>;
  metadata(): AdapterMeta;

  wake(part?: number, total?: number): Promise<WakeResult>;
  note(text: string): Promise<void>;
  recall(pattern: string): Promise<Memory[]>;
  zoom(block: string): Promise<ZoomResult>;
  nap(block: string, text: string): Promise<void>;
  forget(id: string): Promise<void>;
  config(key: string, value: string): Promise<void>;
  import(src: string): Promise<ImportReport>;

  push(): Promise<void>;
  pull(): Promise<void>;
  syncStatus(): Promise<SyncStatus>;
}