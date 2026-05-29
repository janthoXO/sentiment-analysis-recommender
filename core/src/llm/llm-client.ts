import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { APICallError, Output, generateText, type LanguageModel } from "ai";
import type z from "zod";

import { env } from "@/env.js";

export class LlmRateLimitError extends Error {
  constructor(readonly provider: string) {
    super(`${provider} LLM request was rate-limited`);
    this.name = "LlmRateLimitError";
  }
}

type GenerateStructuredObjectOptions<Schema extends z.ZodType> = {
  prompt: string;
  schema: Schema;
  schemaName?: string;
  schemaDescription?: string;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

export async function generateStructuredLlmObject<Schema extends z.ZodType>({
  prompt,
  schema,
  schemaName,
  schemaDescription,
  maxOutputTokens = 512,
  temperature = 0.1,
  timeoutMs = 8000,
}: GenerateStructuredObjectOptions<Schema>): Promise<z.infer<Schema> | null> {
  const model = getLanguageModel();
  if (!model) return null;

  try {
    const result = await generateText({
      model,
      prompt,
      output: Output.object({
        schema,
        name: schemaName,
        description: schemaDescription,
      }),
      maxOutputTokens,
      temperature,
      timeout: timeoutMs,
      maxRetries: 0,
    });

    const parsed = schema.safeParse(result.output);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (APICallError.isInstance(error) && error.statusCode === 429) {
      throw new LlmRateLimitError(env.LLM_PROVIDER);
    }

    throw error;
  }
}

function getLanguageModel(): LanguageModel | null {
  switch (env.LLM_PROVIDER) {
    case "none":
      return null;
    case "gemini":
      return getGeminiModel();
  }
}

function getGeminiModel(): LanguageModel | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.warn("LLM_PROVIDER=gemini but GEMINI_API_KEY is not configured");
    return null;
  }

  const google = createGoogleGenerativeAI({ apiKey });
  return google(normalizeGeminiModel(env.LLM_MODEL));
}

function normalizeGeminiModel(model: string): string {
  return model.trim().replace(/^models\//, "");
}
