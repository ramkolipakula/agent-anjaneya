import { NextRequest, NextResponse } from "next/server";
import { TaskExecutionEngine } from "@/engine/TaskExecutionEngine";

export async function GET() {
  try {
    const fs = TaskExecutionEngine.getInstance().getFileSystem();
    return NextResponse.json({ directories: fs.listAllowedDirectories() });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, path: dirPath, readOnly = false } = body;

    if (!name || !dirPath) {
      return NextResponse.json({ error: "name and path are required" }, { status: 400 });
    }

    const fs = TaskExecutionEngine.getInstance().getFileSystem();
    const newDir = fs.addAllowedDirectory(name, dirPath, readOnly);
    return NextResponse.json({ success: true, directory: newDir });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Directory id is required" }, { status: 400 });
    }

    const fs = TaskExecutionEngine.getInstance().getFileSystem();
    const success = fs.removeAllowedDirectory(id);
    return NextResponse.json({ success });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
