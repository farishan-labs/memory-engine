import { loadConfig, expand } from "./config";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface Identity {
  user: string;
  machine: string;
}

export function getIdentity(): Identity {
  const cfg = loadConfig();
  const user = cfg.identity?.user ?? "faris";
  let machine = cfg.identity?.machine ?? "oscar";
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
        if (found && found !== machine) {
          process.stderr.write(
            `memory: config machine (${machine}) drifted from MEMORY.md (${found}); using MEMORY.md\n`,
          );
          machine = found;
        }
      } catch {
        // ignore
      }
    }
  }
  return { user, machine };
}