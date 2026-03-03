import * as http from "http";
import { loadConfig, getApiKey } from "./config";
import { classify } from "./classifier";
import { translateRequest, translateResponse, responseToSSE } from "./translator";
import { sendRequest } from "./anthropic";
import { OpenAIRequest, OpenAIMessage } from "./types";

function contentToString(content: OpenAIMessage["content"]): string {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === "text")
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("");
  }
  return String(content);
}

function getLastUserMessage(messages: OpenAIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return contentToString(messages[i].content);
    }
  }
  return "";
}

function logRoute(
  lastMsg: string,
  tier: string,
  model: string,
  reason: string
): void {
  const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const preview = lastMsg.slice(0, 50).replace(/\n/g, " ");
  console.log(`[router] ${ts} "${preview}" → ${tier} → ${model} (${reason})`);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function jsonError(
  res: http.ServerResponse,
  status: number,
  message: string
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: { message, type: "proxy_error", code: status },
    })
  );
}

async function handleCompletions(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const config = loadConfig();
  const apiKey = getApiKey();

  // Parse request
  let openaiReq: OpenAIRequest;
  try {
    const raw = await readBody(req);
    openaiReq = JSON.parse(raw);
  } catch {
    jsonError(res, 400, "Invalid JSON request body");
    return;
  }

  if (!openaiReq.messages || openaiReq.messages.length === 0) {
    jsonError(res, 400, "messages array is required");
    return;
  }

  // Classify
  const lastMessage = getLastUserMessage(openaiReq.messages);
  let tier: string;
  let reason: string;
  let model: string;

  try {
    const result = classify(lastMessage, config);
    tier = result.tier;
    reason = result.reason;
    model = config.tiers[result.tier];
  } catch {
    // Default to standard on classification failure
    tier = "standard";
    reason = "classification error (defaulting)";
    model = config.tiers.standard;
  }

  logRoute(lastMessage, tier, model, reason);

  // Translate and forward
  const wantsStream = openaiReq.stream === true;
  const anthropicReq = translateRequest(openaiReq, model);

  try {
    const anthropicResp = await sendRequest(anthropicReq, apiKey);

    if (wantsStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(responseToSSE(anthropicResp));
      res.end();
    } else {
      const openaiResp = translateResponse(anthropicResp);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(openaiResp));
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("timed out")) {
      jsonError(res, 504, "Anthropic API request timed out");
    } else if (message.includes("Anthropic API")) {
      // Forward Anthropic error status
      const match = message.match(/Anthropic API (\d+)/);
      const status = match ? parseInt(match[1], 10) : 502;
      jsonError(res, status, message);
    } else {
      jsonError(res, 502, "Failed to reach Anthropic API: " + message);
    }
  }
}

function start(): void {
  const config = loadConfig();
  const port = config.port;

  const server = http.createServer(async (req, res) => {
    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // Only handle POST /v1/chat/completions
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      await handleCompletions(req, res);
      return;
    }

    jsonError(res, 404, "Not found. Use POST /v1/chat/completions");
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[router] Model router proxy listening on http://127.0.0.1:${port}`);
    console.log(`[router] Tiers: simple=${config.tiers.simple} standard=${config.tiers.standard} complex=${config.tiers.complex}`);
  });
}

start();
