import z from "zod";
import { env } from "@/env.js";

const GeminiResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z.array(
                  z
                    .object({
                      text: z.string().optional(),
                    })
                    .passthrough()
                ),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

export class LlmRequestError extends Error {
  constructor(
    readonly status: number,
    statusText: string
  ) {
    super(
      `LLM request failed (${status}${statusText ? ` ${statusText}` : ""})`
    );
    this.name = "LlmRequestError";
  }
}

export interface GenerateLlmJsonOptions {
  prompt: string;
  maxOutputTokens: number;
  temperature?: number;
  timeoutMs?: number;
  purpose?: string;
}

export async function generateLlmJson(
  opts: GenerateLlmJsonOptions
): Promise<unknown | null> {
  if (env.LLM_PROVIDER !== "gemini") return null;

  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.warn("LLM_PROVIDER=gemini but GEMINI_API_KEY is not configured");
    return null;
  }

  return requestGeminiJson(opts, apiKey);
}

async function requestGeminiJson(
  opts: GenerateLlmJsonOptions,
  apiKey: string
): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  const model = env.LLM_MODEL.replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: opts.prompt }],
          },
        ],
        generationConfig: {
          candidateCount: 1,
          maxOutputTokens: opts.maxOutputTokens,
          responseMimeType: "application/json",
          temperature: opts.temperature ?? 0.1,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new LlmRequestError(response.status, response.statusText);
    }

    const payload = GeminiResponseSchema.parse(await response.json());
    const text =
      payload.candidates
        ?.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text)
        .filter((part): part is string => typeof part === "string")
        .join("")
        .trim() ?? "";

    return text ? parseJsonObject(text) : null;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(
        `LLM request timed out${opts.purpose ? ` for ${opts.purpose}` : ""}`,
        { cause: e }
      );
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonObject(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("LLM response did not contain valid JSON");
  }
}
