import { loadConfig } from "./config";
import { classify } from "./classifier";
import { logRoute } from "./logger";
import { HookContext } from "./types";

function getLastUserMessage(ctx: HookContext): string {
  const messages = ctx.request?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return "";

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return typeof messages[i].content === "string" ? messages[i].content : "";
    }
  }
  return "";
}

function getAllMessages(ctx: HookContext): Array<{ role: string; content: string }> {
  const messages = ctx.request?.messages;
  if (!Array.isArray(messages)) return [];
  return messages as Array<{ role: string; content: string }>;
}

export default function register(api: Record<string, unknown>): void {
  console.log("[model-router] Plugin loaded. API keys:", Object.keys(api));

  const hookFn = (api as { on?: (event: string, handler: (ctx: HookContext) => HookContext) => void }).on
    ?? (api as { hook?: (event: string, handler: (ctx: HookContext) => HookContext) => void }).hook
    ?? (api as { registerHook?: (event: string, handler: (ctx: HookContext) => HookContext) => void }).registerHook;

  if (typeof hookFn !== "function") {
    console.warn(
      "[model-router] No hook registration method found on api. Available keys:",
      Object.keys(api)
    );
    return;
  }

  hookFn.call(api, "before_model_resolve", (ctx: HookContext) => {
    console.log("[model-router] Hook fired. Context keys:", Object.keys(ctx));

    const config = loadConfig();
    const lastMessage = getLastUserMessage(ctx);
    const allMessages = getAllMessages(ctx);

    if (!lastMessage) {
      console.log("[model-router] No user message found, skipping.");
      return ctx;
    }

    const { tier, reason } = classify(lastMessage, allMessages, config);
    const model = config.tiers[tier];

    logRoute(tier, model, reason, lastMessage);

    return { ...ctx, model };
  });

  console.log("[model-router] Registered before_model_resolve hook.");
}

// Also support named export for different plugin loaders
export { register };
