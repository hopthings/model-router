export type Tier = "simple" | "standard" | "complex";

export interface TierConfig {
  simple: string;
  standard: string;
  complex: string;
}

export interface RulesConfig {
  shortCharsSimple: number;
  contextTokensMinComplex: number;
  forceStandardIfLikelyToolUse: boolean;
}

export interface OverridesConfig {
  forceComplexRegex: string;
  forceSimpleRegex: string;
}

export interface RouterConfig {
  tiers: TierConfig;
  rules: RulesConfig;
  overrides: OverridesConfig;
}

export interface ClassifyResult {
  tier: Tier;
  reason: string;
}

export interface HookContext {
  model?: string;
  request?: {
    messages?: Array<{ role: string; content: string }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  tier: Tier;
  model: string;
  reason: string;
  messagePreview: string;
}
