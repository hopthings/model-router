import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LogEntry, Tier } from "./types";

const LOG_DIR = path.join(os.homedir(), ".openclaw", "logs");
const LOG_FILE = path.join(LOG_DIR, "model-router.jsonl");

function ensureLogDir(): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // Best-effort
  }
}

export function logRoute(
  tier: Tier,
  model: string,
  reason: string,
  messagePreview: string
): void {
  const preview = messagePreview.slice(0, 60).replace(/\n/g, " ");

  // Console output (always)
  console.log(`[model-router] tier=${tier} model=${model} reason="${reason}" msg="${preview}"`);

  // File logger (JSONL)
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    tier,
    model,
    reason,
    messagePreview: preview,
  };

  ensureLogDir();
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // Best-effort file logging; console log above is the primary output
  }
}
