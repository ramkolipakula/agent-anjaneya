import { z } from "zod";
import { DesktopTool, ExecutionContext, ToolResult } from "./DesktopTool";
import { AllowedDirectory } from "../filesystem/types";

const listAllowedDirectoriesInputSchema = z.object({});

export type ListAllowedDirectoriesInput = z.infer<typeof listAllowedDirectoriesInputSchema>;

export interface ListAllowedDirectoriesOutput {
  directories: AllowedDirectory[];
}

export class ListAllowedDirectoriesTool implements DesktopTool<ListAllowedDirectoriesInput, ListAllowedDirectoriesOutput> {
  public name = "list_allowed_directories";
  public description = "List all directories currently permitted for read and write operations";
  public inputSchema = listAllowedDirectoriesInputSchema;
  public requiresApproval = false;

  public async execute(_input: ListAllowedDirectoriesInput, context: ExecutionContext): Promise<ToolResult<ListAllowedDirectoriesOutput>> {
    const startTime = Date.now();
    const directories = context.fileSystem.listAllowedDirectories();

    return {
      success: true,
      data: {
        directories,
      },
      durationMs: Date.now() - startTime,
    };
  }
}
