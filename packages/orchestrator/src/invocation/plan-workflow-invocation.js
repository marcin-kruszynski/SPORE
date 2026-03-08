import fs from "node:fs/promises";
import path from "node:path";

import { parseYaml } from "../../../config-schema/src/yaml/parse-yaml.js";
import { PROJECT_ROOT } from "../../../runtime-pi/src/metadata/constants.js";

const DEFAULT_ROLE_PROFILE = {
  orchestrator: "orchestrator",
  lead: "lead",
  scout: "scout",
  builder: "builder",
  tester: "tester",
  reviewer: "reviewer"
};

const DOMAIN_ROLE_KEYS = {
  lead: "leadProfile",
  scout: "scoutProfile",
  builder: "builderProfile",
  tester: "testerProfile",
  reviewer: "reviewerProfile"
};

function resolvePath(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.join(PROJECT_ROOT, inputPath);
}

function normalizeRelativePath(inputPath) {
  if (!inputPath) {
    return null;
  }
  return path.relative(PROJECT_ROOT, inputPath).split(path.sep).join("/");
}

async function readYaml(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return parseYaml(raw);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveDomain(project, domainId) {
  if (!domainId) {
    return null;
  }
  return project.activeDomains?.find((candidate) => candidate.id === domainId) ?? null;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeWorkflowInput(inputPath) {
  if (!inputPath) {
    return null;
  }
  if (inputPath.endsWith(".yaml")) {
    return inputPath;
  }
  return `config/workflows/${inputPath}.yaml`;
}

function pickDefaultWorkflowPath(project, domain) {
  const preferredId =
    domain?.workflowPreferences?.[0] ??
    project.workflowDefaults?.[0] ??
    "feature-delivery";
  return normalizeWorkflowInput(preferredId);
}

async function resolveWorkflowPath(project, domain, inputPath) {
  const candidate = normalizeWorkflowInput(inputPath) ?? pickDefaultWorkflowPath(project, domain);
  const resolved = resolvePath(candidate);
  if (await fileExists(resolved)) {
    return resolved;
  }
  const fallback = resolvePath("config/workflows/feature-delivery.yaml");
  if (!(await fileExists(fallback))) {
    throw new Error(`workflow config not found: ${candidate}`);
  }
  return fallback;
}

async function resolveDomainConfig(domainId) {
  if (!domainId) {
    return { path: null, config: null };
  }
  const candidate = resolvePath(`config/domains/${domainId}.yaml`);
  if (!(await fileExists(candidate))) {
    return { path: null, config: null };
  }
  return {
    path: candidate,
    config: await readYaml(candidate)
  };
}

function mergeObjects(base = {}, overlay = {}) {
  return {
    ...base,
    ...overlay
  };
}

function mergePolicies(domainConfig = {}, domainOverride = {}) {
  return {
    workflowPolicy: {
      ...mergeObjects(domainConfig.workflowPolicy, domainOverride.workflowPolicy),
      maxAttemptsByRole: mergeObjects(
        domainConfig.workflowPolicy?.maxAttemptsByRole,
        domainOverride.workflowPolicy?.maxAttemptsByRole
      ),
      defaultRoles:
        domainOverride.workflowPolicy?.defaultRoles ??
        domainConfig.workflowPolicy?.defaultRoles ??
        null
    },
    runtimePolicy: {
      ...mergeObjects(domainConfig.runtimePolicy, domainOverride.runtimePolicy),
      sessionModeByRole: mergeObjects(
        domainConfig.runtimePolicy?.sessionModeByRole,
        domainOverride.runtimePolicy?.sessionModeByRole
      )
    },
    docsKbPolicy: {
      ...mergeObjects(domainConfig.docsKbPolicy, domainOverride.docsKbPolicy),
      queryTerms: unique([
        ...asArray(domainConfig.docsKbPolicy?.queryTerms),
        ...asArray(domainOverride.docsKbPolicy?.queryTerms)
      ])
    }
  };
}

async function resolveProfilePath(project, domainId, role) {
  const domain = resolveDomain(project, domainId);
  const requestedProfileId = domain && DOMAIN_ROLE_KEYS[role] ? domain[DOMAIN_ROLE_KEYS[role]] : null;
  const effectiveProfileId = requestedProfileId ?? DEFAULT_ROLE_PROFILE[role] ?? role;
  const requestedPath = path.join(PROJECT_ROOT, "config", "profiles", `${effectiveProfileId}.yaml`);
  if (await fileExists(requestedPath)) {
    return {
      requestedProfileId: effectiveProfileId,
      profilePath: requestedPath,
      fallback: false
    };
  }
  const fallbackPath = path.join(PROJECT_ROOT, "config", "profiles", `${role}.yaml`);
  if (!(await fileExists(fallbackPath))) {
    throw new Error(`no profile config found for role ${role}`);
  }
  return {
    requestedProfileId: effectiveProfileId,
    profilePath: fallbackPath,
    fallback: true
  };
}

function determineRoles({ explicitRoles, workflow, policy, maxRoles }) {
  if (Array.isArray(explicitRoles) && explicitRoles.length > 0) {
    return explicitRoles;
  }
  const defaultRoles = asArray(policy.workflowPolicy?.defaultRoles);
  if (defaultRoles.length > 0) {
    return defaultRoles.slice(0, Math.max(1, maxRoles));
  }
  return asArray(workflow.roleSequence).slice(0, Math.max(1, maxRoles));
}

function resolveMaxAttempts(role, workflow, policy) {
  return Number.parseInt(
    String(
      policy.workflowPolicy?.maxAttemptsByRole?.[role] ??
        policy.workflowPolicy?.defaultMaxAttempts ??
        workflow.retryPolicy?.maxAttempts ??
        1
    ),
    10
  );
}

function resolveGovernance(role, workflow, policy) {
  const workflowRequiresReview = workflow.reviewStep?.required ?? role === "reviewer";
  const workflowRequiresApproval =
    workflow.reviewStep?.approvalRequired ?? workflowRequiresReview;
  const reviewRequired =
    role === "reviewer"
      ? policy.workflowPolicy?.reviewRequired ?? workflowRequiresReview
      : false;
  const approvalRequired =
    role === "reviewer"
      ? policy.workflowPolicy?.approvalRequired ?? workflowRequiresApproval
      : false;
  return {
    reviewRequired,
    approvalRequired
  };
}

function buildDocsQuery({ role, domainId, workflow, project, docsKbPolicy }) {
  const template = docsKbPolicy?.queryTemplate ?? null;
  const queryTerms = unique([
    role,
    domainId,
    workflow.id,
    workflow.name,
    project.type,
    ...asArray(docsKbPolicy?.queryTerms)
  ]);
  if (template) {
    return template
      .replaceAll("{role}", role ?? "")
      .replaceAll("{domain}", domainId ?? "shared")
      .replaceAll("{workflow}", workflow.id ?? "")
      .replaceAll("{projectType}", project.type ?? "");
  }
  return queryTerms.filter(Boolean).join(" ");
}

export async function planWorkflowInvocation({
  workflowPath = null,
  projectPath = "config/projects/example-project.yaml",
  domainId = null,
  roles = null,
  maxRoles = 1,
  invocationId = null,
  objective = "",
  coordinationGroupId = null,
  parentExecutionId = null,
  branchKey = null
}) {
  const resolvedProjectPath = resolvePath(projectPath);
  const project = await readYaml(resolvedProjectPath);
  const domain = domainId ? resolveDomain(project, domainId) : null;
  const domainConfig = await resolveDomainConfig(domainId);
  const resolvedWorkflowPath = await resolveWorkflowPath(project, domain, workflowPath);
  const workflow = await readYaml(resolvedWorkflowPath);
  const policy = mergePolicies(domainConfig.config ?? {}, domain ?? {});
  const selectedRoles = determineRoles({
    explicitRoles: roles,
    workflow,
    policy,
    maxRoles
  });
  const effectiveInvocationId = invocationId ?? `invoke-${Date.now()}`;
  const effectiveRunId = `${effectiveInvocationId}-${domainId ?? "shared"}`;
  const timestamp = Date.now();

  const launches = [];
  for (let index = 0; index < selectedRoles.length; index += 1) {
    const role = selectedRoles[index];
    const profile = await resolveProfilePath(project, domainId, role);
    const governance = resolveGovernance(role, workflow, policy);
    const sessionModeOverride = policy.runtimePolicy?.sessionModeByRole?.[role] ?? null;
    const docsQuery = buildDocsQuery({
      role,
      domainId,
      workflow,
      project,
      docsKbPolicy: policy.docsKbPolicy
    });
    launches.push({
      role,
      domainId,
      requestedProfileId: profile.requestedProfileId,
      profilePath: normalizeRelativePath(profile.profilePath),
      profileFallback: profile.fallback,
      projectPath: normalizeRelativePath(resolvedProjectPath),
      workflowPath: normalizeRelativePath(resolvedWorkflowPath),
      sessionId: `${effectiveInvocationId}-${domainId ?? "shared"}-${role}-${index + 1}`,
      runId: `${effectiveRunId}-${timestamp}`,
      maxAttempts: resolveMaxAttempts(role, workflow, policy),
      objective,
      sessionMode: sessionModeOverride,
      reviewRequired: governance.reviewRequired,
      approvalRequired: governance.approvalRequired,
      policy: {
        workflowPolicy: {
          stepSoftTimeoutMs: policy.workflowPolicy?.stepSoftTimeoutMs ?? null,
          stepHardTimeoutMs: policy.workflowPolicy?.stepHardTimeoutMs ?? null,
          maxAttempts: resolveMaxAttempts(role, workflow, policy)
        },
        runtimePolicy: {
          sessionMode: sessionModeOverride
        },
        docsKbPolicy: {
          resultLimit: policy.docsKbPolicy?.resultLimit ?? 5,
          query: docsQuery,
          queryTerms: unique([
            role,
            domainId,
            workflow.id,
            ...asArray(policy.docsKbPolicy?.queryTerms)
          ])
        },
        governance
      }
    });
  }

  return {
    invocationId: effectiveInvocationId,
    objective,
    workflow: {
      id: workflow.id,
      name: workflow.name,
      path: normalizeRelativePath(resolvedWorkflowPath),
      roleSequence: workflow.roleSequence ?? [],
      branchingConditions: workflow.branchingConditions ?? [],
      reviewStep: workflow.reviewStep ?? {},
      retryPolicy: workflow.retryPolicy ?? { maxAttempts: 1 }
    },
    project: {
      id: project.id,
      name: project.name,
      type: project.type,
      path: normalizeRelativePath(resolvedProjectPath)
    },
    domain: domainId ? {
      ...(domain ?? { id: domainId }),
      configPath: normalizeRelativePath(domainConfig.path)
    } : null,
    coordination: {
      groupId: coordinationGroupId ?? effectiveInvocationId,
      parentExecutionId: parentExecutionId ?? null,
      branchKey: branchKey ?? null
    },
    effectivePolicy: {
      workflowPolicy: {
        stepSoftTimeoutMs: policy.workflowPolicy?.stepSoftTimeoutMs ?? null,
        stepHardTimeoutMs: policy.workflowPolicy?.stepHardTimeoutMs ?? null,
        defaultMaxAttempts:
          policy.workflowPolicy?.defaultMaxAttempts ??
          workflow.retryPolicy?.maxAttempts ??
          1,
        defaultRoles:
          policy.workflowPolicy?.defaultRoles ??
          workflow.roleSequence ??
          []
      },
      runtimePolicy: {
        sessionModeByRole: policy.runtimePolicy?.sessionModeByRole ?? {}
      },
      docsKbPolicy: {
        resultLimit: policy.docsKbPolicy?.resultLimit ?? 5,
        queryTerms: asArray(policy.docsKbPolicy?.queryTerms),
        queryTemplate: policy.docsKbPolicy?.queryTemplate ?? null
      }
    },
    launches,
    metadata: {
      sourceFiles: {
        workflow: normalizeRelativePath(resolvedWorkflowPath),
        project: normalizeRelativePath(resolvedProjectPath),
        domainConfig: normalizeRelativePath(domainConfig.path)
      }
    }
  };
}
