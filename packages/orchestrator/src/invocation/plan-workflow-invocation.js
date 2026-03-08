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
  const result = {
    path: candidate,
    config: await readYaml(candidate)
  };
  return result;
}

async function resolvePolicyPack(packId) {
  const candidate = resolvePath(`config/policy-packs/${packId}.yaml`);
  if (!(await fileExists(candidate))) {
    throw new Error(`policy pack not found: ${packId}`);
  }
  return {
    id: packId,
    path: candidate,
    config: await readYaml(candidate)
  };
}

async function resolvePolicyPacks(packIds = []) {
  const packs = [];
  for (const packId of unique(asArray(packIds))) {
    packs.push(await resolvePolicyPack(packId));
  }
  return packs;
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
        null,
      reworkStrategy:
        domainOverride.workflowPolicy?.reworkStrategy ??
        domainConfig.workflowPolicy?.reworkStrategy ??
        null,
      reworkRoles:
        domainOverride.workflowPolicy?.reworkRoles ??
        domainConfig.workflowPolicy?.reworkRoles ??
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

function emptyPolicyContainer() {
  return {
    workflowPolicy: {},
    runtimePolicy: {},
    docsKbPolicy: {}
  };
}

function mergePolicyChain(items = []) {
  return items.reduce((accumulator, item) => mergePolicies(accumulator, item), emptyPolicyContainer());
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

function buildWaveAssignments(workflow, selectedRoles) {
  const selected = asArray(selectedRoles);
  const roleToWave = new Map();
  const roleToWaveName = new Map();
  const roleToWaveGate = new Map();
  const explicitSets = asArray(workflow.stepSets);
  let nextWave = 0;

  for (const set of explicitSets) {
    const roles = asArray(set?.roles).filter((role) => selected.includes(role));
    if (roles.length === 0) {
      continue;
    }
    for (const role of roles) {
      if (!roleToWave.has(role)) {
        roleToWave.set(role, nextWave);
        roleToWaveName.set(role, set?.name ?? `wave-${nextWave + 1}`);
        roleToWaveGate.set(role, set?.gate ?? { mode: "all" });
      }
    }
    nextWave += 1;
  }

  for (const role of selected) {
    if (!roleToWave.has(role)) {
      roleToWave.set(role, nextWave);
      roleToWaveName.set(role, `wave-${nextWave + 1}`);
      roleToWaveGate.set(role, { mode: "all" });
      nextWave += 1;
    }
  }

  return selected.map((role, sequence) => ({
    role,
    sequence,
    wave: roleToWave.get(role) ?? sequence,
    waveName: roleToWaveName.get(role) ?? `wave-${sequence + 1}`,
    waveGate: roleToWaveGate.get(role) ?? { mode: "all" }
  }));
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
  const domainPolicyPacks = await resolvePolicyPacks([
    ...asArray(domainConfig.config?.policyPacks),
    ...asArray(domain?.policyPacks)
  ]);
  const resolvedWorkflowPath = await resolveWorkflowPath(project, domain, workflowPath);
  const workflow = await readYaml(resolvedWorkflowPath);
  const policy = mergePolicyChain([
    ...domainPolicyPacks.map((pack) => pack.config ?? {}),
    domainConfig.config ?? {},
    domain ?? {}
  ]);
  const selectedRoles = determineRoles({
    explicitRoles: roles,
    workflow,
    policy,
    maxRoles
  });
  const effectiveInvocationId = invocationId ?? `invoke-${Date.now()}`;
  const effectiveRunId = `${effectiveInvocationId}-${domainId ?? "shared"}`;
  const timestamp = Date.now();
  const waveAssignments = buildWaveAssignments(workflow, selectedRoles);
  const waveSizes = waveAssignments.reduce((accumulator, assignment) => {
    accumulator[assignment.wave] = (accumulator[assignment.wave] ?? 0) + 1;
    return accumulator;
  }, {});

  const launches = [];
  for (let index = 0; index < waveAssignments.length; index += 1) {
    const assignment = waveAssignments[index];
    const role = assignment.role;
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
      sequence: index,
      wave: assignment.wave,
      waveName: assignment.waveName,
      waveGate: assignment.waveGate,
      waveSize: waveSizes[assignment.wave] ?? 1,
      maxAttempts: resolveMaxAttempts(role, workflow, policy),
      objective,
      sessionMode: sessionModeOverride,
      reviewRequired: governance.reviewRequired,
      approvalRequired: governance.approvalRequired,
      policy: {
        workflowPolicy: {
          stepSoftTimeoutMs: policy.workflowPolicy?.stepSoftTimeoutMs ?? null,
          stepHardTimeoutMs: policy.workflowPolicy?.stepHardTimeoutMs ?? null,
          maxAttempts: resolveMaxAttempts(role, workflow, policy),
          waveGate: assignment.waveGate
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

  const result = {
    invocationId: effectiveInvocationId,
    objective,
    workflow: {
      id: workflow.id,
      name: workflow.name,
      path: normalizeRelativePath(resolvedWorkflowPath),
      roleSequence: workflow.roleSequence ?? [],
      stepSets: asArray(workflow.stepSets),
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
        retryTargetRole: policy.workflowPolicy?.retryTargetRole ?? null,
        resetDescendantSteps: policy.workflowPolicy?.resetDescendantSteps ?? false,
        reworkStrategy: policy.workflowPolicy?.reworkStrategy ?? null,
        reworkRoles: asArray(policy.workflowPolicy?.reworkRoles),
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
      },
      policyPackIds: domainPolicyPacks.map((pack) => pack.id)
    },
    launches,
    metadata: {
      sourceFiles: {
        workflow: normalizeRelativePath(resolvedWorkflowPath),
        project: normalizeRelativePath(resolvedProjectPath),
        domainConfig: normalizeRelativePath(domainConfig.path)
      },
      policyPacks: domainPolicyPacks.map((pack) => ({
        id: pack.id,
        path: normalizeRelativePath(pack.path),
        name: pack.config?.name ?? pack.id
      }))
    }
  };

  if (result.domain) {
    result.domain.policyPacks = domainPolicyPacks.map((pack) => pack.id);
  }

  return result;
}
