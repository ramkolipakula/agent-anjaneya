import { z } from "zod";

export interface ProviderOptions {
  model?: string;
  timeoutMs?: number;
  temperature?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

export interface TokenMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface ProviderResult<T> {
  data: T;
  metrics: TokenMetrics;
  latencyMs: number;
  providerId: string;
  modelId: string;
}

export interface AIModelProvider {
  id: string;
  name: string;
  defaultModel: string;

  generateStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: ProviderOptions
  ): Promise<ProviderResult<T>>;
}

/**
 * Calculates estimated cost in USD based on standard published pricing.
 */
export function calculateTokenCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const lower = model.toLowerCase();
  let promptRatePerMillion = 0.15; // default affordable rate
  let completionRatePerMillion = 0.60;

  if (lower.includes("gpt-4o-mini") || lower.includes("flash")) {
    promptRatePerMillion = 0.15;
    completionRatePerMillion = 0.60;
  } else if (lower.includes("gpt-4o") || lower.includes("sonnet")) {
    promptRatePerMillion = 3.00;
    completionRatePerMillion = 15.00;
  } else if (lower.includes("rule-based") || lower.includes("local")) {
    return 0;
  }

  const cost =
    (promptTokens / 1_000_000) * promptRatePerMillion +
    (completionTokens / 1_000_000) * completionRatePerMillion;

  return Math.round(cost * 1_000_000) / 1_000_000;
}
