import fs from "node:fs/promises";
import path from "node:path";

import { parseYaml } from "../../../config-schema/src/yaml/parse-yaml.js";
import { DEFAULT_DOCS_INDEX, DEFAULT_RUNTIME_CONFIG, PROJECT_ROOT } from "../metadata/constants.js";

function relativeToProject(filePath) {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/");
}

async function readYaml(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return parseYaml(raw);
}

function resolveInputPath(inputPath) {
  if (!inputPath) {
    return null;
  }
  return path.isAbsolute(inputPath) ? inputPath : path.join(PROJECT_ROOT, inputPath);
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
  contextLimit = null
}) {
  if (!profilePath) {
    throw new Error("profilePath is required");
  }

  const resolvedProfilePath = resolveInputPath(profilePath);
  const resolvedRuntimePath = resolveInputPath(runtimeConfigPath);
  const resolvedProjectPath = resolveInputPath(projectPath);

  const profile = await readYaml(resolvedProfilePath);
  const runtimeConfig = await readYaml(resolvedRuntimePath);
  const project = resolvedProjectPath ? await readYaml(resolvedProjectPath) : null;

  const adapter =
    runtimeConfig.runtimeAdapters?.find((candidate) => candidate.id === profile.runtime) ?? null;

  if (!adapter) {
    throw new Error(`no runtime adapter found for profile runtime "${profile.runtime}"`);
  }

  const effectiveSessionId = sessionId ?? `${profile.id}-${Date.now()}`;
  const effectiveRunId = runId ?? `run-${Date.now()}`;
  const plan = {
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
      transcriptCapture: runtimeConfig.sessionDefaults?.captureTranscript ?? true,
      storeRoot: runtimeConfig.sessionDefaults?.storeRoot ?? "tmp/sessions"
    },
    project: project
      ? {
          id: project.id,
          name: project.name,
          type: project.type,
          docsLocation: project.docsLocation,
          workflowDefaults: project.workflowDefaults ?? []
        }
      : null,
    pi: {
      systemPromptRef: profile.systemPromptRef,
      contextFiles: [
        "AGENTS.md",
        ".pi/SYSTEM.md",
        relativeToProject(DEFAULT_DOCS_INDEX)
      ],
      skills: profile.skills ?? [],
      tools: profile.tools ?? [],
      permissions: profile.permissions ?? [],
      docsPolicy: profile.docsPolicy ?? {},
      telemetryPolicy: profile.telemetryPolicy ?? {},
      handoffPolicy: profile.handoffPolicy ?? {},
      reviewPolicy: profile.reviewPolicy ?? {}
    },
    retrieval: {
      query: contextQuery ?? null,
      queryTerms: Array.isArray(contextQueryTerms) ? contextQueryTerms : [],
      limit: contextLimit ? Number.parseInt(String(contextLimit), 10) : 5
    },
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceFiles: {
        profile: relativeToProject(resolvedProfilePath),
        runtime: relativeToProject(resolvedRuntimePath),
        project: resolvedProjectPath ? relativeToProject(resolvedProjectPath) : null
      }
    }
  };

  return plan;
}
