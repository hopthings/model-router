import { ClassifyResult, Tier, RouterConfig } from "./types";
import { sendRequest } from "./anthropic";

const CLASSIFICATION_MODEL = "claude-haiku-4-5-20251001";

const CLASSIFICATION_PROMPT = `Classify this user message for an AI coding assistant. Reply with exactly one word: simple, standard, or complex.

simple: greetings, short factual questions, trivial lookups, quick clarifications, yes/no questions, small typo fixes
standard: normal coding tasks, bug fixes, moderate features, explanations, code review, single-file changes, tool use
complex: architecture design, large multi-file refactors, multi-system integration, deep reasoning, long-form writing, formal proofs, full feature implementation across multiple components`;

// ── Rule-based fast path (no LLM call) ──

function matchesRegex(text: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return false;
  }
}

function ruleBasedFastPath(lastMessage: string, config: RouterConfig): ClassifyResult | null {
  const { overrides } = config;

  // Manual overrides
  if (matchesRegex(lastMessage, overrides.forceComplexRegex)) {
    return { tier: "complex", reason: "manual override /opus" };
  }
  if (matchesRegex(lastMessage, overrides.forceSimpleRegex)) {
    return { tier: "simple", reason: "manual override /cheap" };
  }

  // Test hooks
  if (lastMessage.trim() === "router-test-simple") {
    return { tier: "simple", reason: "test hook" };
  }
  if (lastMessage.trim() === "router-test-standard") {
    return { tier: "standard", reason: "test hook" };
  }
  if (lastMessage.trim() === "router-test-complex") {
    return { tier: "complex", reason: "test hook" };
  }

  // Heartbeat / system messages
  if (lastMessage.includes("HEARTBEAT") || lastMessage.includes("[System Message]")) {
    return { tier: "standard", reason: "heartbeat/system" };
  }

  return null; // No fast-path match — use LLM
}

// ── Keyword fallback (used when LLM classification fails) ──

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

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function keywordFallback(lastMessage: string, config: RouterConfig): ClassifyResult {
  const { rules } = config;

  if (containsAny(lastMessage, REASONING_KEYWORDS)) {
    return { tier: "complex", reason: "keyword fallback: reasoning" };
  }
  if (containsAny(lastMessage, COMPLEX_KEYWORDS)) {
    return { tier: "complex", reason: "keyword fallback: complexity" };
  }
  if (rules.forceStandardIfLikelyToolUse && containsAny(lastMessage, TOOL_KEYWORDS)) {
    return { tier: "standard", reason: "keyword fallback: tool use" };
  }
  if (lastMessage.length < rules.shortCharsSimple) {
    return { tier: "simple", reason: `keyword fallback: short (${lastMessage.length} chars)` };
  }
  return { tier: "standard", reason: "keyword fallback: default" };
}

// ── LLM classification via Haiku ──

function parseTier(response: string): Tier | null {
  const word = response.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (word === "simple" || word === "standard" || word === "complex") {
    return word;
  }
  return null;
}

async function llmClassify(lastMessage: string, apiKey: string): Promise<ClassifyResult | null> {
  try {
    const resp = await sendRequest(
      {
        model: CLASSIFICATION_MODEL,
        system: CLASSIFICATION_PROMPT,
        messages: [{ role: "user", content: lastMessage }],
        max_tokens: 10,
        stream: false,
      },
      apiKey
    );

    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const tier = parseTier(text);
    if (tier) {
      return { tier, reason: `haiku: ${tier}` };
    }

    console.log(`[router] Haiku returned unparseable response: "${text}"`);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[router] Haiku classification failed: ${msg.slice(0, 100)}`);
    return null;
  }
}

// ── Public API ──

export function classify(lastMessage: string, config: RouterConfig): ClassifyResult {
  return ruleBasedFastPath(lastMessage, config) ?? keywordFallback(lastMessage, config);
}

export async function classifyWithLLM(
  lastMessage: string,
  config: RouterConfig,
  apiKey: string
): Promise<ClassifyResult> {
  // Fast path: rule-based (instant, no LLM call)
  const fast = ruleBasedFastPath(lastMessage, config);
  if (fast) return fast;

  // LLM classification via Haiku
  const llmResult = await llmClassify(lastMessage, apiKey);
  if (llmResult) return llmResult;

  // Fallback: keyword-based
  return keywordFallback(lastMessage, config);
}
