#!/usr/bin/env node
import {
  createWorkspace,
  inspectWorkspace,
  listGitWorktrees,
  reconcileWorkspace,
  removeWorkspace,
  workspaceCommandHint,
} from "../manager.js";
import type { ParsedArgs } from "../types.js";

type CliFlags = Record<string, string | boolean | undefined>;

function parseArgs(argv: string[]): ParsedArgs<CliFlags>["flags"] {
  const flags: CliFlags = {};
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

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseArgs(rest);

  if (!command || ["help", "--help", "-h"].includes(command)) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          commands: ["create", "list", "show", "cleanup", "reconcile"],
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "list") {
    const detail = await listGitWorktrees({ repoRoot: asString(flags.repo) });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "show") {
    const worktreePath = asString(flags.path);
    if (!worktreePath) {
      throw new Error("show requires --path <worktree-path>");
    }
    const detail = await inspectWorkspace({
      repoRoot: asString(flags.repo),
      worktreePath,
      branchName: asString(flags.branch) ?? null,
    });
    console.log(
      JSON.stringify(
        { ok: true, detail, commandHint: workspaceCommandHint(detail) },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "create") {
    const workspaceId = asString(flags.id);
    const ownerId = asString(flags["owner-id"]);
    if (!workspaceId || !ownerId) {
      throw new Error(
        "create requires --id <workspace-id> and --owner-id <owner-id>",
      );
    }
    const detail = await createWorkspace({
      repoRoot: asString(flags.repo),
      workspaceId,
      projectId: asString(flags.project) ?? "default",
      ownerType: asString(flags["owner-type"]) ?? "work-item-run",
      ownerId,
      baseRef: asString(flags.base) ?? "HEAD",
      branchName: asString(flags.branch) ?? null,
      safeMode: asString(flags["safe-mode"]) !== "false",
      mutationScope: asString(flags.scope)
        ? String(asString(flags.scope))
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [],
    });
    console.log(
      JSON.stringify(
        { ok: true, detail, commandHint: workspaceCommandHint(detail) },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "cleanup") {
    const worktreePath = asString(flags.path);
    if (!worktreePath) {
      throw new Error("cleanup requires --path <worktree-path>");
    }
    const detail = await removeWorkspace({
      repoRoot: asString(flags.repo),
      worktreePath,
      force: Boolean(flags.force),
      branchName: asString(flags.branch) ?? null,
      keepBranch: Boolean(flags["keep-branch"]),
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "reconcile") {
    const worktreePath = asString(flags.path);
    if (!worktreePath) {
      throw new Error("reconcile requires --path <worktree-path>");
    }
    const detail = await reconcileWorkspace({
      repoRoot: asString(flags.repo),
      allocation: {
        id: asString(flags.id) ?? null,
        worktreePath,
        branchName: asString(flags.branch) ?? null,
      },
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({ ok: false, error: getErrorMessage(error) }, null, 2),
  );
  process.exitCode = 1;
});
