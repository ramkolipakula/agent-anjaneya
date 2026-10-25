import { ContextProvider, ContextQuery, ContextResult } from "./ContextProvider";
import { SecureFileSystem } from "../filesystem/SecureFileSystem";

export interface UserPreferences {
  defaultOutputDirectory?: string;
  preferredFramework?: string;
  autoApproveReadOnly?: boolean;
  theme?: "dark" | "light";
}

export class UserPreferencesProvider implements ContextProvider {
  public readonly name = "UserPreferencesProvider";
  private preferences: UserPreferences;

  constructor(preferences?: UserPreferences) {
    this.preferences = preferences || {
      preferredFramework: "Next.js",
      autoApproveReadOnly: true,
      theme: "dark",
    };
  }

  public updatePreferences(newPrefs: Partial<UserPreferences>): void {
    this.preferences = { ...this.preferences, ...newPrefs };
  }

  public async getContext(query: ContextQuery, fileSystem: SecureFileSystem): Promise<ContextResult[]> {
    const start = Date.now();
    return [
      {
        providerName: this.name,
        key: "userPreferences",
        data: this.preferences,
        summary: `User prefers ${this.preferences.preferredFramework || "standard"} tools, dark theme`,
        latencyMs: Date.now() - start,
      },
    ];
  }
}
