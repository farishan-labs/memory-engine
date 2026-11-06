import { loadConfig, expand } from "./config";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

let driftWarned = false;

export interface Identity {
  user: string;
  machine: string;
}

export function getIdentity(): Identity {
  const cfg = loadConfig();
  const user = cfg.identity?.user ?? "faris";
  // Identity is resolved dynamically per machine: the local config
  // (~/.config/memory/config.yaml) is the source of truth because it is
  // NOT shared across machines (unlike MEMORY.md in the store repo).
  // MEMORY_MACHINE remains an emergency override, logged.
  let machine = cfg.identity?.machine ?? "";
  if (!machine) {
    // Fall back to the hostname when no machine is configured, so a fresh
    // install on a new machine gets a sensible, machine-specific value
    // instead of a stale shared default.
    try {
      machine = (process.env.HOSTNAME || require("node:os").hostname() || "").trim();
    } catch {
      machine = "";
    }
  }
  if (!machine) machine = "unknown";
  if (process.env.MEMORY_MACHINE) {
    process.stderr.write(`memory: MEMORY_MACHINE override -> ${process.env.MEMORY_MACHINE}\n`);
    machine = process.env.MEMORY_MACHINE;
  }
  const dataDir = (cfg.adapters?.[cfg.active_adapter] as Record<string, unknown> | undefined)?.data_dir;
  if (typeof dataDir === "string") {
    const p = join(expand(dataDir), "MEMORY.md");
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf8");
        const m = content.match(/^Machine:\s*(.+)$/m);
        const found = m?.[1]?.trim();
        // MEMORY.md lives in the shared store repo and may describe another
        // machine. It is informational only: never let it clobber the local
        // per-machine identity. Warn on drift instead.
        if (found && found !== machine && !driftWarned) {
          driftWarned = true;
          process.stderr.write(
            `memory: MEMORY.md machine (${found}) differs from local identity (${machine}); local config wins\n`,
          );
        }
      } catch {
        // ignore
      }
    }
  }
  return { user, machine };
}