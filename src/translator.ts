import {
  OpenAIRequest,
  OpenAIMessage,
  OpenAIResponse,
  OpenAIStreamChunk,
  OpenAIToolCall,
  AnthropicRequest,
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicResponse,
  AnthropicTool,
} from "./types";

// ── Helpers ──

// OpenAI content can be a string, null, or an array of content parts.
// Normalize to a plain string for cases where we need text.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function contentToString(content: any): string {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p.type === "text")
      .map((p: any) => (typeof p.text === "string" ? p.text : ""))
      .join("");
  }
  return String(content);
}

// ── Request: OpenAI → Anthropic ──

export function translateRequest(req: OpenAIRequest, model: string): AnthropicRequest {
  let system: string | undefined;
  const messages: AnthropicMessage[] = [];

  // Single-pass: extract system, convert messages, group tool results
  for (const msg of req.messages) {
    if (msg.role === "system") {
      const text = contentToString(msg.content);
      system = system ? system + "\n\n" + text : text;
      continue;
    }

    if (msg.role === "tool") {
      const block: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id!,
        content: contentToString(msg.content),
      };

      // Merge consecutive tool results into one user message
      const last = messages[messages.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        const lastBlocks = last.content as AnthropicContentBlock[];
        if (lastBlocks.length > 0 && lastBlocks[0].type === "tool_result") {
          lastBlocks.push(block);
          continue;
        }
      }

      messages.push({ role: "user", content: [block] });
      continue;
    }

    if (msg.role === "assistant") {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const blocks: AnthropicContentBlock[] = [];

        const text = contentToString(msg.content);
        if (text) {
          blocks.push({ type: "text", text });
        }

        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            input = { _raw: tc.function.arguments };
          }
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }

        messages.push({ role: "assistant", content: blocks });
      } else {
        messages.push({ role: "assistant", content: contentToString(msg.content) });
      }
      continue;
    }

    // role === "user"
    messages.push({ role: "user", content: contentToString(msg.content) });
  }

  const result: AnthropicRequest = {
    model,
    messages,
    max_tokens: req.max_tokens ?? 8192,
    stream: false, // non-streaming for now
  };

  if (system) result.system = system;
  if (req.temperature !== undefined) result.temperature = req.temperature;

  // Translate tools
  if (req.tools && req.tools.length > 0) {
    result.tools = req.tools.map((t): AnthropicTool => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters ?? { type: "object", properties: {} },
    }));
  }

  if (req.tool_choice !== undefined) result.tool_choice = req.tool_choice;

  return result;
}

// ── Response: Anthropic → OpenAI (non-streaming) ──

function mapStopReason(reason: string): string {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return "stop";
  }
}

export function translateResponse(resp: AnthropicResponse): OpenAIResponse {
  let textContent: string | null = null;
  const toolCalls: OpenAIToolCall[] = [];

  for (const block of resp.content) {
    if (block.type === "text") {
      textContent = textContent ? textContent + block.text : block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  const message: OpenAIResponse["choices"][0]["message"] = {
    role: "assistant",
    content: textContent,
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  return {
    id: "chatcmpl-" + resp.id.replace("msg_", ""),
    object: "chat.completion",
    model: "auto",
    choices: [
      {
        index: 0,
        message,
        finish_reason: mapStopReason(resp.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: resp.usage.input_tokens,
      completion_tokens: resp.usage.output_tokens,
      total_tokens: resp.usage.input_tokens + resp.usage.output_tokens,
    },
  };
}

// ── Streaming: wrap a non-streaming response as SSE chunks ──

export function responseToSSE(resp: AnthropicResponse): string {
  const openaiResp = translateResponse(resp);
  const choice = openaiResp.choices[0];

  // Initial chunk with role
  const roleChunk: OpenAIStreamChunk = {
    id: openaiResp.id,
    object: "chat.completion.chunk",
    model: "auto",
    choices: [{
      index: 0,
      delta: { role: "assistant" },
      finish_reason: null,
    }],
  };

  const chunks: string[] = [];
  chunks.push("data: " + JSON.stringify(roleChunk) + "\n\n");

  // Content chunk(s)
  if (choice.message.content) {
    const contentChunk: OpenAIStreamChunk = {
      id: openaiResp.id,
      object: "chat.completion.chunk",
      model: "auto",
      choices: [{
        index: 0,
        delta: { content: choice.message.content },
        finish_reason: null,
      }],
    };
    chunks.push("data: " + JSON.stringify(contentChunk) + "\n\n");
  }

  // Tool call chunks
  if (choice.message.tool_calls) {
    for (let i = 0; i < choice.message.tool_calls.length; i++) {
      const tc = choice.message.tool_calls[i];
      const tcChunk: OpenAIStreamChunk = {
        id: openaiResp.id,
        object: "chat.completion.chunk",
        model: "auto",
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: i,
              id: tc.id,
              type: "function",
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            }],
          },
          finish_reason: null,
        }],
      };
      chunks.push("data: " + JSON.stringify(tcChunk) + "\n\n");
    }
  }

  // Final chunk with finish_reason + usage
  const finalChunk: OpenAIStreamChunk = {
    id: openaiResp.id,
    object: "chat.completion.chunk",
    model: "auto",
    choices: [{
      index: 0,
      delta: {},
      finish_reason: choice.finish_reason,
    }],
    usage: openaiResp.usage,
  };
  chunks.push("data: " + JSON.stringify(finalChunk) + "\n\n");
  chunks.push("data: [DONE]\n\n");

  return chunks.join("");
}
