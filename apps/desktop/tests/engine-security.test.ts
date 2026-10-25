import fs from "fs";
import path from "path";
import os from "os";
import { SecureFileSystem } from "../src/engine/filesystem/SecureFileSystem";
import { ToolRegistry } from "../src/engine/tools/ToolRegistry";
import { TaskPlanner } from "../src/engine/planner/TaskPlanner";
import { ExecutionContext } from "../src/engine/tools/DesktopTool";
import { AuditLogger } from "../src/engine/audit/AuditLogger";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✔ Passed: ${message}`);
}

async function runEngineSecurityTests() {
  console.log("\n=======================================================");
  console.log("=== RUNNING PHASE 2 ENGINE SECURITY & TOOL TESTS ======");
  console.log("=======================================================\n");

  const testTempDir = path.join(os.tmpdir(), "agent_anjaneya_test_" + Math.random().toString(36).substring(7));
  fs.mkdirSync(testTempDir, { recursive: true });

  const allowedDir1 = path.join(testTempDir, "Videos");
  const allowedDirReadOnly = path.join(testTempDir, "ReadOnlyDocs");
  fs.mkdirSync(allowedDir1, { recursive: true });
  fs.mkdirSync(allowedDirReadOnly, { recursive: true });

  const sfs = new SecureFileSystem([
    { id: "dir-vid", name: "Videos", path: allowedDir1, readOnly: false, isDefault: true },
    { id: "dir-ro", name: "Docs", path: allowedDirReadOnly, readOnly: true },
  ]);

  console.log("--- Test 1: Filesystem Allowlisting ---");
  const validPath = path.join(allowedDir1, "video.mp4");
  const val1 = sfs.validatePath(validPath, "read");
  assert(val1.allowed, "Path within allowed directory is permitted for reading");

  const outsidePath = path.join(os.homedir(), "SecretFolder", "data.txt");
  const val2 = sfs.validatePath(outsidePath, "read");
  assert(!val2.allowed, "Arbitrary path outside configured allowlist is rejected");

  console.log("\n--- Test 2: Path Traversal Prevention ---");
  const traversalAttempt1 = path.join(allowedDir1, "..", "..", "Windows", "System32", "cmd.exe");
  const val3 = sfs.validatePath(traversalAttempt1, "read");
  assert(!val3.allowed, "Path traversal with '..' attempting escape is blocked");

  const traversalAttempt2 = path.join(allowedDir1, "sub", "..", "..", "..", "passwords.txt");
  const val4 = sfs.validatePath(traversalAttempt2, "read");
  assert(!val4.allowed, "Deep path traversal escape is blocked");

  console.log("\n--- Test 3: Null Byte Poisoning Prevention ---");
  const nullByteAttempt = path.join(allowedDir1, "safe.mp4\0.exe");
  const val5 = sfs.validatePath(nullByteAttempt, "read");
  assert(!val5.allowed, "Null byte injection is immediately detected and blocked");
  assert(val5.error?.includes("Null byte detected") || false, "Descriptive null byte error returned");

  console.log("\n--- Test 4: System Directory Protection ---");
  const sysAttempt1 = "C:\\Windows\\System32\\calc.exe";
  const val6 = sfs.validatePath(sysAttempt1, "read");
  assert(!val6.allowed, "Direct Windows directory access is denied");

  const sysAttempt2 = "C:\\Program Files\\app\\file.txt";
  const val7 = sfs.validatePath(sysAttempt2, "read");
  assert(!val7.allowed, "Program Files access is denied");

  console.log("\n--- Test 5: Sensitive Files & Secret Protection ---");
  const secretEnv = path.join(allowedDir1, ".env");
  const val8 = sfs.validatePath(secretEnv, "read");
  assert(!val8.allowed, "Access to .env file is strictly denied even inside allowed directory");

  const secretSsh = path.join(allowedDir1, "id_rsa");
  const val9 = sfs.validatePath(secretSsh, "read");
  assert(!val9.allowed, "Access to SSH private key 'id_rsa' is strictly denied");

  const secretCert = path.join(allowedDir1, "server.key");
  const val10 = sfs.validatePath(secretCert, "read");
  assert(!val10.allowed, "Access to private key file (*.key) is strictly denied");

  console.log("\n--- Test 6: Read-Only Directory Protection ---");
  const writeReadOnly = path.join(allowedDirReadOnly, "newfile.txt");
  const val11 = sfs.validatePath(writeReadOnly, "write");
  assert(!val11.allowed, "Write attempt to read-only configured directory is denied");
  assert(val11.error?.includes("read-only") || false, "Descriptive read-only error returned");

  console.log("\n--- Test 7: TaskPlanner Natural Language Parsing ---");
  const planner = new TaskPlanner();

  // Test standard user request
  const plan1 = await planner.plan("Find video.mp4 in my Videos folder and extract the first 10 seconds", "task-1");
  assert(plan1.intent === "VIDEO_TRIM", "Intent correctly identified as VIDEO_TRIM");
  assert(plan1.sourceFile === "video.mp4", "Source file correctly extracted as video.mp4");
  assert(plan1.operation.type === "TRIM", "Operation type is TRIM");
  assert(plan1.operation.durationSeconds === 10, "Duration seconds correctly parsed as 10");
  assert(plan1.requiresApproval === true, "requiresApproval is true for video modification");
  assert(plan1.toolName === "trim_video", "Tool selected is trim_video");

  // Test List Folders
  const plan2 = await planner.plan("List allowed folders", "task-2");
  assert(plan2.intent === "LIST_DIRECTORIES", "List allowed folders identified as LIST_DIRECTORIES");
  assert(plan2.requiresApproval === false, "Read-only list directories does not require approval");

  // Test Unsupported Operation / Injection attempt
  const plan3 = await planner.plan("format C: /y && rm -rf /", "task-3");
  assert(plan3.intent === "UNSUPPORTED", "Arbitrary shell command returns UNSUPPORTED");

  console.log("\n--- Test 8: ToolRegistry & Execution Security ---");
  const registry = new ToolRegistry();

  assert(registry.hasTool("find_file"), "find_file is registered");
  assert(registry.hasTool("trim_video"), "trim_video is registered");
  assert(registry.hasTool("verify_output"), "verify_output is registered");
  assert(registry.hasTool("get_file_metadata"), "get_file_metadata is registered");
  assert(registry.hasTool("list_allowed_directories"), "list_allowed_directories is registered");
  assert(!registry.hasTool("shell"), "Strictly NO shell tool exists");
  assert(!registry.hasTool("bash"), "Strictly NO bash tool exists");
  assert(!registry.hasTool("cmd"), "Strictly NO cmd tool exists");
  assert(!registry.hasTool("powershell"), "Strictly NO powershell tool exists");

  const dummyContext: ExecutionContext = {
    taskId: "test-task",
    fileSystem: sfs,
  };

  // Execute unapproved tool
  const unapprovedResult = await registry.executeTool("arbitrary_bash", {}, dummyContext);
  assert(!unapprovedResult.success, "Execution of unapproved tool fails");
  assert(unapprovedResult.error === "UNSUPPORTED_OPERATION", "Returns UNSUPPORTED_OPERATION");

  // Input validation failure
  const badInputResult = await registry.executeTool("find_file", { filename: "" }, dummyContext);
  assert(!badInputResult.success, "Invalid empty input fails validation");
  assert(badInputResult.error?.includes("INVALID_INPUT") || false, "Descriptive INVALID_INPUT error returned");

  console.log("\n--- Test 9: FindFileTool Execution ---");
  const testSampleFile = path.join(allowedDir1, "sample_clip.mp4");
  fs.writeFileSync(testSampleFile, "mock video content");

  const findResult1 = await registry.executeTool(
    "find_file",
    { filename: "sample_clip.mp4", directory: "Videos" },
    dummyContext
  );
  assert(findResult1.success, "find_file succeeds for existing file");
  assert(findResult1.data.matches.length === 1, "Exactly 1 match found");
  assert(findResult1.data.matches[0].name === "sample_clip.mp4", "Found matching filename");

  // Missing file handling
  const findResult2 = await registry.executeTool(
    "find_file",
    { filename: "nonexistent.mp4", directory: "Videos" },
    dummyContext
  );
  assert(findResult2.success, "find_file for missing file completes without crash");
  assert(findResult2.data.matches.length === 0, "Returns 0 matches for non-existent file");

  console.log("\n--- Test 10: Output Verification Tool ---");
  // Test verifying existing file
  const verifyResult1 = await registry.executeTool(
    "verify_output",
    { filePath: testSampleFile, expectedMinSize: 5 },
    dummyContext
  );
  assert(verifyResult1.success, "verify_output passes for valid non-empty file");
  assert(verifyResult1.data.verified === true, "Output confirmed verified");

  // Test non-existent file
  const verifyResult2 = await registry.executeTool(
    "verify_output",
    { filePath: path.join(allowedDir1, "missing.mp4") },
    dummyContext
  );
  assert(!verifyResult2.success, "verify_output fails for missing file");
  assert(verifyResult2.error?.includes("does not exist") || false, "Reports file does not exist");

  // Test 0-byte empty file
  const emptyFile = path.join(allowedDir1, "empty.mp4");
  fs.writeFileSync(emptyFile, "");
  const verifyResult3 = await registry.executeTool(
    "verify_output",
    { filePath: emptyFile, expectedMinSize: 1 },
    dummyContext
  );
  assert(!verifyResult3.success, "verify_output fails for 0-byte file");

  // Cleanup test directory
  try {
    fs.rmSync(testTempDir, { recursive: true, force: true });
  } catch (e) {}

  console.log("\n=======================================================");
  console.log("🎉 ALL ENGINE SECURITY & TOOL TESTS PASSED!");
  console.log("=======================================================\n");
}

runEngineSecurityTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
