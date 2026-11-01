// Append-only debug log for opencode-speak.
// Enable with the `debugLog: true` plugin option. Writes to
// ~/.local/state/opencode-speak/debug.log. Synchronous appends: the volume
// is tiny (a few lines per turn) and this never blocks the event loop
// meaningfully.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LOG_FILE = path.join(os.homedir(), ".local", "state", "opencode-speak", "debug.log");

export interface Logger {
  log(message: string): void;
}

export function createLogger(enabled: boolean, tag: string): Logger {
  if (!enabled) return { log: () => {} };
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  } catch {
    return { log: () => {} };
  }
  return {
    log(message: string) {
      try {
        fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${tag}] ${message}\n`);
      } catch {
        // Logging must never break speech.
      }
    },
  };
}
