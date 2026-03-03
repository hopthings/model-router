// ── Config ──

export type Tier = "simple" | "standard" | "complex";

export interface RouterConfig {
  port: number;
  tiers: Record<Tier, string>;
  rules: {
    shortCharsSimple: number;
    forceStandardIfLikelyToolUse: boolean;
  };
  overrides: {
    forceComplexRegex: string;
    forceSimpleRegex: string;
  };
}

export interface ClassifyResult {
  tier: Tier;
  reason: string;
}

// ── OpenAI (incoming from OpenClaw) ──

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: unknown;
}

export interface OpenAIContentPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null | OpenAIContentPart[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIResponse {
  id: string;
  object: "chat.completion";
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: "assistant";
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── Anthropic (outgoing to API) ──

export interface AnthropicRequest {
  model: string;
  system?: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  temperature?: number;
  stream: boolean;
  tools?: AnthropicTool[];
  tool_choice?: unknown;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: "end_turn" | "stop_sequence" | "max_tokens" | "tool_use";
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}
