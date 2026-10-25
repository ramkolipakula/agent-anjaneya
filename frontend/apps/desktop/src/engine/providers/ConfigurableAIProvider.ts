import { z } from "zod";
import { AIModelProvider, ProviderOptions, ProviderResult, calculateTokenCost } from "./AIModelProvider";

export interface ConfigurableProviderConfig {
  id?: string;
  name?: string;
  endpoint?: string;
  apiKey?: string;
  defaultModel?: string;
  providerType: "openai" | "anthropic" | "gemini" | "custom";
  maxRetries?: number;
  defaultTimeoutMs?: number;
}

export class ConfigurableAIProvider implements AIModelProvider {
  public readonly id: string;
  public readonly name: string;
  public readonly defaultModel: string;
  private config: ConfigurableProviderConfig;

  constructor(config: ConfigurableProviderConfig) {
    this.config = config;
    this.id = config.id || `provider-${config.providerType}`;
    this.name = config.name || `Configurable (${config.providerType.toUpperCase()})`;
    this.defaultModel =
      config.defaultModel ||
      (config.providerType === "openai"
        ? "gpt-4o-mini"
        : config.providerType === "anthropic"
        ? "claude-3-5-sonnet-20241022"
        : config.providerType === "gemini"
        ? "gemini-1.5-flash"
        : "custom-model");
  }

  public async generateStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: ProviderOptions
  ): Promise<ProviderResult<T>> {
    const start = Date.now();
    const timeoutMs = options?.timeoutMs || this.config.defaultTimeoutMs || 5000;
    const maxRetries = options?.maxRetries ?? this.config.maxRetries ?? 2;
    const model = options?.model || this.defaultModel;

    let lastError: any = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (options?.signal?.aborted) {
        throw new Error("OPERATION_CANCELLED: Operation aborted by client signal");
      }

      try {
        // If an API key or mock endpoint is not configured in environment, check if apiKey is present
        const apiKey = this.config.apiKey || process.env[`${this.config.providerType.toUpperCase()}_API_KEY`];
        if (!apiKey && !this.config.endpoint) {
          throw new Error(
            `CONFIG_ERROR: No API key or custom endpoint configured for provider '${this.name}' (${this.config.providerType})`
          );
        }

        // Perform HTTP call with AbortController timeout
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        // Combined abort with options?.signal
        if (options?.signal) {
          options.signal.addEventListener("abort", () => controller.abort(), { once: true });
        }

        const endpoint =
          this.config.endpoint ||
          (this.config.providerType === "openai"
            ? "https://api.openai.com/v1/chat/completions"
            : this.config.providerType === "gemini"
            ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
            : "https://api.anthropic.com/v1/messages");

        // Example call envelope
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`HTTP ${response.status} from ${this.name}: ${errText}`);
        }

        const json = await response.json();
        const contentStr = json.choices?.[0]?.message?.content || JSON.stringify(json);
        const parsedRaw = JSON.parse(contentStr);
        const data = schema.parse(parsedRaw);

        const promptTokens = json.usage?.prompt_tokens || Math.ceil(prompt.length / 4);
        const completionTokens = json.usage?.completion_tokens || Math.ceil(contentStr.length / 4);

        return {
          data,
          metrics: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            estimatedCostUsd: calculateTokenCost(model, promptTokens, completionTokens),
          },
          latencyMs: Date.now() - start,
          providerId: this.id,
          modelId: model,
        };
      } catch (err: any) {
        lastError = err;
        if (err.name === "AbortError") {
          throw new Error(`TIMEOUT: Provider '${this.name}' timed out after ${timeoutMs}ms`);
        }
        if (attempt < maxRetries) {
          // Exponential backoff
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 100));
        }
      }
    }

    throw lastError || new Error(`Failed to generate output from provider '${this.name}'`);
  }
}
