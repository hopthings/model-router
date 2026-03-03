import { ClassifyResult, RouterConfig } from "./types";

const TOOL_KEYWORDS = [
  "exec", "browser", "web_fetch", "web_search", "notion",
  "wordpress", "wp ", "database", "deploy", "ssh",
  "kubectl", "docker", "playwright", "puppeteer", "selenium",
  "api call", "http request", "curl", "fetch(",
];

const COMPLEX_KEYWORDS = [
  "article", "synthesis", "architecture", "refactor", "redesign",
  "implement", "build me", "full implementation", "comprehensive",
  "multi-step", "analyze", "compare and contrast", "deep dive",
  "write a complete", "entire system", "end to end", "migration",
];

const REASONING_KEYWORDS = [
  "prove", "theorem", "formal logic", "step by step",
  "mathematical proof", "derive", "induction", "contradiction",
  "formal verification", "axiom",
];

function matchesRegex(text: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return false;
  }
}

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export function classify(lastMessage: string, config: RouterConfig): ClassifyResult {
  const { rules, overrides } = config;

  // 1. Manual overrides
  if (matchesRegex(lastMessage, overrides.forceComplexRegex)) {
    return { tier: "complex", reason: "manual override /opus" };
  }
  if (matchesRegex(lastMessage, overrides.forceSimpleRegex)) {
    return { tier: "simple", reason: "manual override /cheap" };
  }

  // 2. Test hooks
  if (lastMessage.trim() === "router-test-simple") {
    return { tier: "simple", reason: "test hook" };
  }
  if (lastMessage.trim() === "router-test-complex") {
    return { tier: "complex", reason: "test hook" };
  }

  // 3. Heartbeat / system messages
  if (lastMessage.includes("HEARTBEAT") || lastMessage.includes("[System Message]")) {
    return { tier: "standard", reason: "heartbeat/system" };
  }

  // 4. Reasoning indicators → complex
  if (containsAny(lastMessage, REASONING_KEYWORDS)) {
    return { tier: "complex", reason: "reasoning indicators" };
  }

  // 5. Complex indicators → complex
  if (containsAny(lastMessage, COMPLEX_KEYWORDS)) {
    return { tier: "complex", reason: "complexity indicators" };
  }

  // 6. Likely tool use → standard
  if (rules.forceStandardIfLikelyToolUse && containsAny(lastMessage, TOOL_KEYWORDS)) {
    return { tier: "standard", reason: "likely tool use" };
  }

  // 7. Short message → simple
  if (lastMessage.length < rules.shortCharsSimple) {
    return { tier: "simple", reason: `short message (${lastMessage.length} chars)` };
  }

  // 8. Default → standard
  return { tier: "standard", reason: "default" };
}
