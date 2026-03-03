import * as fs from "fs";
import * as path from "path";
import { RouterConfig } from "./types";

const DEFAULT_CONFIG: RouterConfig = {
  tiers: {
    simple: "anthropic/claude-haiku-4-5-20251001",
    standard: "anthropic/claude-sonnet-4-20250514",
    complex: "anthropic/claude-opus-4-6",
  },
  rules: {
    shortCharsSimple: 80,
    contextTokensMinComplex: 120000,
    forceStandardIfLikelyToolUse: true,
  },
  overrides: {
    forceComplexRegex: "^/opus\\b",
    forceSimpleRegex: "^/cheap\\b",
  },
};

let cached: RouterConfig | null = null;

export function loadConfig(pluginDir?: string): RouterConfig {
  if (cached) return cached;

  const configPath = path.join(pluginDir ?? __dirname, "..", "config.json");

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    cached = { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    cached = DEFAULT_CONFIG;
  }

  return cached!;
}

export function resetConfigCache(): void {
  cached = null;
}
