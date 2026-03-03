import * as fs from "fs";
import * as path from "path";
import { RouterConfig } from "./types";

const DEFAULT_CONFIG: RouterConfig = {
  port: 3456,
  tiers: {
    simple: "claude-haiku-4-5-20251001",
    standard: "claude-sonnet-4-20250514",
    complex: "claude-opus-4-6",
  },
  rules: {
    shortCharsSimple: 80,
    forceStandardIfLikelyToolUse: true,
  },
  overrides: {
    forceComplexRegex: "^/opus\\b",
    forceSimpleRegex: "^/cheap\\b",
  },
};

export function loadConfig(): RouterConfig {
  const configPath = path.join(__dirname, "..", "config.json");

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }
  return key;
}
