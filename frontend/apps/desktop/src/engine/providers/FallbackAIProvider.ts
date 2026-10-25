import { z } from "zod";
import { AIModelProvider, ProviderOptions, ProviderResult } from "./AIModelProvider";
import { AuditLogger } from "../audit/AuditLogger";

export class FallbackAIProvider implements AIModelProvider {
  public readonly id = "fallback-provider";
  public readonly name = "Cascading Fallback Provider";
  public readonly defaultModel: string;
  private providers: AIModelProvider[];
  private auditLogger: AuditLogger;

  constructor(providers: AIModelProvider[], auditLogger?: AuditLogger) {
    if (!providers || providers.length === 0) {
      throw new Error("FallbackAIProvider requires at least one provider");
    }
    this.providers = providers;
    this.defaultModel = providers[0].defaultModel;
    this.auditLogger = auditLogger || AuditLogger.getInstance();
  }

  public async generateStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: ProviderOptions
  ): Promise<ProviderResult<T>> {
    const errors: Array<{ provider: string; error: string }> = [];

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];

      if (options?.signal?.aborted) {
        throw new Error("OPERATION_CANCELLED: Operation aborted by signal");
      }

      try {
        const result = await provider.generateStructured(prompt, schema, options);
        if (i > 0) {
          this.auditLogger.log({
            taskId: "planning-fallback",
            eventType: "PLANNING",
            action: `Fallback succeeded using '${provider.name}' (${provider.id})`,
            status: "SUCCESS",
            details: { previousErrors: errors },
          });
        }
        return result;
      } catch (err: any) {
        errors.push({ provider: provider.name, error: err.message });
        this.auditLogger.log({
          taskId: "planning-fallback",
          eventType: "PLANNING",
          action: `Provider '${provider.name}' failed: ${err.message}`,
          status: "FAILURE",
          error: err.message,
        });

        // If this is not the last provider, continue to next
        if (i < this.providers.length - 1) {
          console.warn(`[FallbackAIProvider] Provider '${provider.name}' failed. Falling back to next provider.`);
        }
      }
    }

    const aggregatedMessage = errors.map((e) => `[${e.provider}: ${e.error}]`).join(", ");
    throw new Error(`ALL_PROVIDERS_FAILED: All ${this.providers.length} AI providers failed: ${aggregatedMessage}`);
  }
}
