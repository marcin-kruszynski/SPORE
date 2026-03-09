#!/usr/bin/env node
import {
  createWorkspace,
  inspectWorkspace,
  listGitWorktrees,
  reconcileWorkspace,
  removeWorkspace,
  workspaceCommandHint
} from "../manager.js";

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseArgs(rest);

  if (!command || ["help", "--help", "-h"].includes(command)) {
    console.log(JSON.stringify({ ok: true, commands: ["create", "list", "show", "cleanup", "reconcile"] }, null, 2));
    return;
  }

  if (command === "list") {
    const detail = await listGitWorktrees({ repoRoot: flags.repo });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "show") {
    const detail = await inspectWorkspace({
      repoRoot: flags.repo,
      worktreePath: flags.path,
      branchName: flags.branch ?? null
    });
    console.log(JSON.stringify({ ok: true, detail, commandHint: workspaceCommandHint(detail) }, null, 2));
    return;
  }

  if (command === "create") {
    const detail = await createWorkspace({
      repoRoot: flags.repo,
      workspaceId: flags.id,
      projectId: flags.project ?? "default",
      ownerType: flags["owner-type"] ?? "work-item-run",
      ownerId: flags["owner-id"],
      baseRef: flags.base ?? "HEAD",
      branchName: flags.branch ?? null,
      safeMode: flags["safe-mode"] !== "false",
      mutationScope: flags.scope ? String(flags.scope).split(",").map((entry) => entry.trim()).filter(Boolean) : []
    });
    console.log(JSON.stringify({ ok: true, detail, commandHint: workspaceCommandHint(detail) }, null, 2));
    return;
  }

  if (command === "cleanup") {
    const detail = await removeWorkspace({
      repoRoot: flags.repo,
      worktreePath: flags.path,
      force: Boolean(flags.force),
      branchName: flags.branch ?? null,
      keepBranch: Boolean(flags["keep-branch"])
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "reconcile") {
    const detail = await reconcileWorkspace({
      repoRoot: flags.repo,
      allocation: {
        id: flags.id ?? null,
        worktreePath: flags.path,
        branchName: flags.branch ?? null
      }
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
