import type { Adapter } from "./types";

// Hardcoded registry in v1. New adapter = code change + rebuild.
// Dynamic import() deferred to v2.
import { OptmemAdapter } from "../adapters/optmem";

export const registry: Record<string, () => Adapter> = {
  optmem: () => new OptmemAdapter(),
};

export function getAdapter(name: string): Adapter {
  const factory = registry[name];
  if (!factory) {
    throw new Error(`Unknown adapter: ${name}. Available: ${Object.keys(registry).join(", ")}`);
  }
  return factory();
}

export function listAdapters(): string[] {
  return Object.keys(registry);
}