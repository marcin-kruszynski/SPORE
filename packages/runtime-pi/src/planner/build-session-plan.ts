import fs from "node:fs/promises";
import path from "node:path";

import { parseYaml } from "@spore/config-schema";
import {
  DEFAULT_DOCS_INDEX,
  DEFAULT_RUNTIME_CONFIG,
  PROJECT_ROOT,
} from "../metadata/constants.js";
import type {
  RuntimeConfig,
  RuntimeProfile,
  RuntimeProjectConfig,
  SessionPlan,
} from "../types.js";

export interface BuildSessionPlanOptions {
  profilePath: string;
  runtimeConfigPath?: string | null;
  projectPath?: string | null;
  domainId?: string | null;
  workflowId?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  sessionMode?: string | null;
  contextQuery?: string | null;
  contextQueryTerms?: string[] | null;
  contextLimit?: string | number | null;
  cwd?: string | null;
  workspaceId?: string | null;
  workspaceBranch?: string | null;
  workspaceBaseRef?: string | null;
  workspacePurpose?: string | null;
  workspaceSourceId?: string | null;
  workspaceSourceRef?: string | null;
  workspaceSourceCommit?: string | null;
}

function relativeToProject(filePath: string): string {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/");
}

async function readYaml<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return parseYaml(raw) as T;
}

function resolveInputPath(inputPath?: string | null): string | null {
  if (!inputPath) {
    return null;
  }
  return path.isAbsolute(inputPath)
    ? inputPath
    : path.join(PROJECT_ROOT, inputPath);
}

function resolveRequiredInputPath(
  inputPath: string | null | undefined,
  label: string,
): string {
  const resolved = resolveInputPath(inputPath);
  if (!resolved) {
    throw new Error(`${label} is required`);
  }
  return resolved;
}

export async function buildSessionPlan({
  profilePath,
  runtimeConfigPath = DEFAULT_RUNTIME_CONFIG,
  projectPath = null,
  domainId = null,
  workflowId = null,
  sessionId = null,
  runId = null,
  sessionMode = null,
  contextQuery = null,
  contextQueryTerms = null,
  contextLimit = null,
  cwd = null,
  workspaceId = null,
  workspaceBranch = null,
  workspaceBaseRef = null,
  workspacePurpose = null,
  workspaceSourceId = null,
  workspaceSourceRef = null,
  workspaceSourceCommit = null,
}: BuildSessionPlanOptions): Promise<SessionPlan> {
  const resolvedProfilePath = resolveRequiredInputPath(
    profilePath,
    "profilePath",
  );
  const resolvedRuntimePath = resolveRequiredInputPath(
    runtimeConfigPath,
    "runtimeConfigPath",
  );
  const resolvedProjectPath = resolveInputPath(projectPath);
  const resolvedCwd = resolveInputPath(cwd);

  const profile = await readYaml<RuntimeProfile>(resolvedProfilePath);
  const runtimeConfig = await readYaml<RuntimeConfig>(resolvedRuntimePath);
  const project = resolvedProjectPath
    ? await readYaml<RuntimeProjectConfig>(resolvedProjectPath)
    : null;

  const adapter =
    runtimeConfig.runtimeAdapters?.find(
      (candidate) => candidate.id === profile.runtime,
    ) ?? null;

  if (!adapter) {
    throw new Error(
      `no runtime adapter found for profile runtime "${profile.runtime}"`,
    );
  }

  const effectiveSessionId = sessionId ?? `${profile.id}-${Date.now()}`;
  const effectiveRunId = runId ?? `run-${Date.now()}`;
  const plan: SessionPlan = {
    version: 1,
    runtime: "pi",
    adapterId: adapter.id,
    adapterPackage: adapter.package,
    sessionTransport: adapter.sessionTransport,
    session: {
      id: effectiveSessionId,
      runId: effectiveRunId,
      role: profile.role,
      domainId,
      workflowId,
      profileId: profile.id,
      profileName: profile.name,
      sessionMode: sessionMode ?? profile.sessionMode,
      transportMode: runtimeConfig.sessionDefaults?.mode ?? "local-process",
      transcriptCapture:
        runtimeConfig.sessionDefaults?.captureTranscript ?? true,
      storeRoot: runtimeConfig.sessionDefaults?.storeRoot ?? "tmp/sessions",
      cwd: resolvedCwd ? relativeToProject(resolvedCwd) : null,
    },
    project: project
      ? {
          id: project.id,
          name: project.name,
          type: project.type,
          docsLocation: project.docsLocation,
          workflowDefaults: project.workflowDefaults ?? [],
        }
      : null,
    pi: {
      systemPromptRef: profile.systemPromptRef,
      contextFiles: [
        "AGENTS.md",
        ".pi/SYSTEM.md",
        relativeToProject(DEFAULT_DOCS_INDEX),
      ],
      skills: profile.skills ?? [],
      tools: profile.tools ?? [],
      permissions: profile.permissions ?? [],
      docsPolicy: profile.docsPolicy ?? {},
      telemetryPolicy: profile.telemetryPolicy ?? {},
      handoffPolicy: profile.handoffPolicy ?? {},
      reviewPolicy: profile.reviewPolicy ?? {},
    },
    retrieval: {
      query: contextQuery ?? null,
      queryTerms: Array.isArray(contextQueryTerms) ? contextQueryTerms : [],
      limit: contextLimit ? Number.parseInt(String(contextLimit), 10) : 5,
    },
    metadata: {
      generatedAt: new Date().toISOString(),
      workspace:
        workspaceId || cwd
          ? {
              id: workspaceId ?? null,
              branchName: workspaceBranch ?? null,
              baseRef: workspaceBaseRef ?? null,
              cwd: resolvedCwd ? relativeToProject(resolvedCwd) : null,
              purpose: workspacePurpose ?? null,
              sourceWorkspaceId: workspaceSourceId ?? null,
              sourceRef: workspaceSourceRef ?? null,
              sourceCommit: workspaceSourceCommit ?? null,
            }
          : null,
      sourceFiles: {
        profile: relativeToProject(resolvedProfilePath),
        runtime: relativeToProject(resolvedRuntimePath),
        project: resolvedProjectPath
          ? relativeToProject(resolvedProjectPath)
          : null,
      },
    },
  };

  return plan;
}
