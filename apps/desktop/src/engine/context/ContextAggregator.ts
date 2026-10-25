import { ContextProvider, ContextQuery, ContextResult } from "./ContextProvider";
import { FilesystemContextProvider } from "./FilesystemContextProvider";
import { ProjectContextProvider } from "./ProjectContextProvider";
import { TaskHistoryProvider } from "./TaskHistoryProvider";
import { UserPreferencesProvider } from "./UserPreferencesProvider";
import { SecureFileSystem } from "../filesystem/SecureFileSystem";

export interface AggregatedContext {
  results: Record<string, any>;
  summaries: string[];
  totalLatencyMs: number;
  providerLatencies: Record<string, number>;
}

export class ContextAggregator {
  private providers: ContextProvider[] = [];

  constructor(providers?: ContextProvider[]) {
    if (providers && providers.length > 0) {
      this.providers = providers;
    } else {
      this.providers = [
        new FilesystemContextProvider(),
        new ProjectContextProvider(),
        new TaskHistoryProvider(),
        new UserPreferencesProvider(),
      ];
    }
  }

  public registerProvider(provider: ContextProvider): void {
    this.providers.push(provider);
  }

  public async gatherContext(
    query: ContextQuery,
    fileSystem: SecureFileSystem,
    timeoutMs = 1500
  ): Promise<AggregatedContext> {
    const overallStart = Date.now();
    const providerLatencies: Record<string, number> = {};
    const results: Record<string, any> = {};
    const summaries: string[] = [];

    // Query all providers in parallel with timeout
    const promises = this.providers.map(async (provider) => {
      const pStart = Date.now();
      try {
        const timeoutPromise = new Promise<ContextResult[]>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout in ${provider.name}`)), timeoutMs)
        );
        const pResults = await Promise.race([provider.getContext(query, fileSystem), timeoutPromise]);
        providerLatencies[provider.name] = Date.now() - pStart;
        return pResults;
      } catch (err: any) {
        providerLatencies[provider.name] = Date.now() - pStart;
        return [
          {
            providerName: provider.name,
            key: `error:${provider.name}`,
            data: { error: err.message },
            summary: `${provider.name} failed or timed out: ${err.message}`,
            latencyMs: Date.now() - pStart,
          },
        ];
      }
    });

    const gatheredLists = await Promise.all(promises);

    for (const list of gatheredLists) {
      for (const item of list) {
        results[item.key] = item.data;
        if (item.summary) {
          summaries.push(item.summary);
        }
      }
    }

    return {
      results,
      summaries,
      totalLatencyMs: Date.now() - overallStart,
      providerLatencies,
    };
  }
}
