import * as https from "https";
import { AnthropicRequest, AnthropicResponse } from "./types";

const API_HOST = "api.anthropic.com";
const API_PATH = "/v1/messages";
const API_VERSION = "2023-06-01";

export function sendRequest(
  body: AnthropicRequest,
  apiKey: string
): Promise<AnthropicResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);

    const req = https.request(
      {
        hostname: API_HOST,
        path: API_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");

          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Anthropic API ${res.statusCode}: ${raw}`));
            return;
          }

          try {
            resolve(JSON.parse(raw) as AnthropicResponse);
          } catch {
            reject(new Error(`Failed to parse Anthropic response: ${raw.slice(0, 200)}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(120_000, () => {
      req.destroy(new Error("Anthropic API request timed out (120s)"));
    });

    req.write(payload);
    req.end();
  });
}
