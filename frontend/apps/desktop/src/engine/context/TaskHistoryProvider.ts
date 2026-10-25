import { ContextProvider, ContextQuery, ContextResult } from "./ContextProvider";
import { SecureFileSystem } from "../filesystem/SecureFileSystem";

export interface HistoricTaskSummary {
  id: string;
  inputText: string;
  status: string;
  completedAt?: string;
  outputPath?: string;
}

export class TaskHistoryProvider implements ContextProvider {
  public readonly name = "TaskHistoryProvider";
  private history: HistoricTaskSummary[] = [];

  constructor(initialHistory?: HistoricTaskSummary[]) {
    if (initialHistory) {
      this.history = initialHistory;
    }
  }

  public setHistory(history: HistoricTaskSummary[]): void {
    this.history = history;
  }

  public addEntry(entry: HistoricTaskSummary): void {
    this.history.unshift(entry);
    if (this.history.length > 20) {
      this.history.pop();
    }
  }

  public async getContext(query: ContextQuery, fileSystem: SecureFileSystem): Promise<ContextResult[]> {
    const start = Date.now();
    const recent = this.history.slice(0, 5);

    return [
      {
        providerName: this.name,
        key: "recentTasks",
        data: recent,
        summary:
          recent.length > 0
            ? `Past tasks: ${recent.map((t) => `'${t.inputText}' (${t.status})`).join("; ")}`
            : "No previous task history",
        latencyMs: Date.now() - start,
      },
    ];
  }
}
