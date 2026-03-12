import {
  agents as seedAgents,
  projects as seedProjects,
  skills as seedSkills,
  spaces as seedSpaces,
  teams as seedTeams,
  tools as seedTools,
} from "../data/mock-data.js";
import type {
  Agent,
  Project,
  Skill,
  Space,
  Team,
  Tool,
} from "../data/mock-data.js";

export const MOCK_CATALOG_SOURCE = "mock";
export const MOCK_CATALOG_NOTICE =
  "Preview only. These routes are intentionally seeded from mock catalog data until dedicated catalog APIs exist.";
export const MOCK_CATALOG_READ_ONLY_COPY =
  "Unsupported create and edit actions are intentionally disabled in this shell.";

export interface SettingsPreviewEntry {
  label: string;
  value: string;
}

export interface SettingsPreviewSection {
  id: string;
  title: string;
  description: string;
  entries: ReadonlyArray<SettingsPreviewEntry>;
}

const SETTINGS_PREVIEW_SEED: SettingsPreviewSection[] = [
  {
    id: "identity",
    title: "Platform Identity",
    description: "Seed values shown for shell composition and operator copy only.",
    entries: [
      { label: "Platform name", value: "SPORE Production" },
      { label: "Instance id", value: "spore-prod-8f42b1c3" },
      { label: "Default timezone", value: "UTC" },
    ],
  },
  {
    id: "orchestrator",
    title: "Orchestrator Defaults",
    description: "Snapshot of planned model and concurrency defaults from the transplant seed.",
    entries: [
      { label: "Primary model", value: "GPT-4o" },
      { label: "Retry policy", value: "3 retries for transient failures" },
      { label: "Concurrent missions", value: "10 active missions" },
    ],
  },
  {
    id: "governance",
    title: "Governance Gates",
    description: "Preview of approvals and validation guardrails without any live write surface.",
    entries: [
      { label: "Production approvals", value: "Required" },
      { label: "Dual-operator approval", value: "Planned for production promotions" },
      { label: "Critical findings", value: "Block promotion" },
    ],
  },
  {
    id: "validation",
    title: "Validation Policy",
    description: "Illustrative quality thresholds retained from the reference catalog state.",
    entries: [
      { label: "Coverage threshold", value: "80%" },
      { label: "Required checks", value: "Unit, integration, lint, dependency audit" },
      { label: "Flaky retry policy", value: "Auto-rerun up to 3 times" },
    ],
  },
  {
    id: "notifications",
    title: "Notification Channels",
    description: "Seeded alert preferences shown as read-only operator context.",
    entries: [
      { label: "Primary channels", value: "In-app inbox, email" },
      { label: "Digest cadence", value: "Real-time" },
      { label: "High-priority events", value: "Approvals, blockers, validation failures" },
    ],
  },
  {
    id: "security",
    title: "Security Defaults",
    description: "Preview of intended sandbox and audit defaults, not live policy state.",
    entries: [
      { label: "Sandbox level", value: "Strict" },
      { label: "Outbound network", value: "Blocked by default" },
      { label: "Audit logging", value: "All agent actions" },
    ],
  },
];

function deepFreeze<T>(value: T): Readonly<T> {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }

    return Object.freeze(value) as Readonly<T>;
  }

  if (value && typeof value === "object") {
    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nestedValue);
    }

    return Object.freeze(value) as Readonly<T>;
  }

  return value as Readonly<T>;
}

function freezeSnapshot<T>(value: T): Readonly<T> {
  return deepFreeze(structuredClone(value));
}

function indexById<T extends { id: string }>(records: ReadonlyArray<T>) {
  return new Map(records.map((record) => [record.id, record]));
}

function collectReferencingIds<T extends { id: string }>(
  records: ReadonlyArray<T>,
  getReferencedIds: (record: T) => ReadonlyArray<string>,
) {
  const idsByReference = new Map<string, string[]>();

  for (const record of records) {
    for (const referencedId of getReferencedIds(record)) {
      const ids = idsByReference.get(referencedId);
      if (ids) {
        ids.push(record.id);
        continue;
      }

      idsByReference.set(referencedId, [record.id]);
    }
  }

  return idsByReference;
}

function getSortedIds(idsByReference: Map<string, string[]>, referenceId: string) {
  return idsByReference.get(referenceId)?.toSorted() ?? [];
}

function assertReferenceIds(
  ownerLabel: string,
  ownerId: string,
  referenceLabel: string,
  referencedIds: ReadonlyArray<string>,
  knownIds: ReadonlySet<string>,
) {
  for (const referencedId of referencedIds) {
    if (!knownIds.has(referencedId)) {
      throw new Error(
        `${ownerLabel} ${ownerId} references unknown ${referenceLabel} ${referencedId}`,
      );
    }
  }
}

function cloneRecord<T>(record: T): Readonly<T> {
  return freezeSnapshot(record);
}

function cloneRecords<T>(records: ReadonlyArray<T>): ReadonlyArray<Readonly<T>> {
  return freezeSnapshot(records);
}

const sourceProjects = freezeSnapshot(seedProjects) as ReadonlyArray<Project>;
const sourceAgents = freezeSnapshot(seedAgents) as ReadonlyArray<Agent>;
const sourceSpaces = freezeSnapshot(seedSpaces) as ReadonlyArray<Space>;
const sourceTeams = freezeSnapshot(seedTeams) as ReadonlyArray<Team>;
const sourceSkills = freezeSnapshot(seedSkills) as ReadonlyArray<Skill>;
const sourceTools = freezeSnapshot(seedTools) as ReadonlyArray<Tool>;

const knownSpaceIds = new Set(sourceSpaces.map((space) => space.id));
const knownTeamIds = new Set(sourceTeams.map((team) => team.id));
const knownSkillIds = new Set(sourceSkills.map((skill) => skill.id));
const knownToolIds = new Set(sourceTools.map((tool) => tool.id));

for (const project of sourceProjects) {
  assertReferenceIds("Project", project.id, "space", [project.spaceId], knownSpaceIds);
  assertReferenceIds("Project", project.id, "team", project.teamIds, knownTeamIds);
}

for (const agent of sourceAgents) {
  assertReferenceIds("Agent", agent.id, "team", agent.teamIds, knownTeamIds);
  assertReferenceIds("Agent", agent.id, "skill", agent.skillIds, knownSkillIds);
  assertReferenceIds("Agent", agent.id, "tool", agent.toolIds, knownToolIds);
}

const projectIdsBySpace = collectReferencingIds(sourceProjects, (project) => [project.spaceId]);
const agentIdsByTeam = collectReferencingIds(sourceAgents, (agent) => agent.teamIds);
const projectIdsByTeam = collectReferencingIds(sourceProjects, (project) => project.teamIds);
const agentIdsBySkill = collectReferencingIds(sourceAgents, (agent) => agent.skillIds);
const agentIdsByTool = collectReferencingIds(sourceAgents, (agent) => agent.toolIds);

const catalogStore = {
  spaces: freezeSnapshot(
    sourceSpaces.map((space) => ({
      ...space,
      projectCount: getSortedIds(projectIdsBySpace, space.id).length,
    })),
  ) as ReadonlyArray<Space>,
  teams: freezeSnapshot(
    sourceTeams.map((team) => ({
      ...team,
      agentIds: getSortedIds(agentIdsByTeam, team.id),
      projectIds: getSortedIds(projectIdsByTeam, team.id),
    })),
  ) as ReadonlyArray<Team>,
  agents: sourceAgents,
  skills: freezeSnapshot(
    sourceSkills.map((skill) => ({
      ...skill,
      agentIds: getSortedIds(agentIdsBySkill, skill.id),
    })),
  ) as ReadonlyArray<Skill>,
  tools: freezeSnapshot(
    sourceTools.map((tool) => ({
      ...tool,
      agentIds: getSortedIds(agentIdsByTool, tool.id),
    })),
  ) as ReadonlyArray<Tool>,
  projects: sourceProjects,
  settingsPreviewSections: freezeSnapshot(SETTINGS_PREVIEW_SEED) as ReadonlyArray<SettingsPreviewSection>,
};

const spacesById = indexById(catalogStore.spaces);
const teamsById = indexById(catalogStore.teams);
const agentsById = indexById(catalogStore.agents);
const skillsById = indexById(catalogStore.skills);
const toolsById = indexById(catalogStore.tools);
const projectsById = indexById(catalogStore.projects);

export const catalogSpaces = catalogStore.spaces;
export const catalogTeams = catalogStore.teams;
export const catalogAgents = catalogStore.agents;
export const catalogSkills = catalogStore.skills;
export const catalogTools = catalogStore.tools;
export const catalogProjects = catalogStore.projects;
export const settingsPreviewSections = catalogStore.settingsPreviewSections;

export function getCatalogSpace(id: string) {
  const space = spacesById.get(id);
  return space ? cloneRecord(space) : undefined;
}

export function getCatalogTeam(id: string) {
  const team = teamsById.get(id);
  return team ? cloneRecord(team) : undefined;
}

export function getCatalogAgent(id: string) {
  const agent = agentsById.get(id);
  return agent ? cloneRecord(agent) : undefined;
}

export function getCatalogSkill(id: string) {
  const skill = skillsById.get(id);
  return skill ? cloneRecord(skill) : undefined;
}

export function getCatalogTool(id: string) {
  const tool = toolsById.get(id);
  return tool ? cloneRecord(tool) : undefined;
}

export function getCatalogProject(id: string) {
  const project = projectsById.get(id);
  return project ? cloneRecord(project) : undefined;
}

const LIVE_PROJECT_ROUTES: Record<string, string> = {
  spore: "/projects/spore",
};

export function getLiveProjectHref(project: Pick<Project, "name">) {
  return LIVE_PROJECT_ROUTES[project.name] ?? null;
}

export function getProjectsForSpace(spaceId: string) {
  return cloneRecords(
    catalogStore.projects.filter((project) => project.spaceId === spaceId),
  );
}

export function getAgentsForTeam(teamId: string) {
  return cloneRecords(
    catalogStore.agents.filter((agent) => agent.teamIds.includes(teamId)),
  );
}

export function getProjectsForTeam(teamId: string) {
  return cloneRecords(
    catalogStore.projects.filter((project) => project.teamIds.includes(teamId)),
  );
}

export function getSkillsForAgent(agentId: string) {
  const agent = agentsById.get(agentId);
  if (!agent) {
    return [];
  }

  return cloneRecords(
    agent.skillIds
      .map((skillId) => skillsById.get(skillId))
      .filter((skill): skill is Skill => Boolean(skill)),
  );
}

export function getToolsForAgent(agentId: string) {
  const agent = agentsById.get(agentId);
  if (!agent) {
    return [];
  }

  return cloneRecords(
    agent.toolIds
      .map((toolId) => toolsById.get(toolId))
      .filter((tool): tool is Tool => Boolean(tool)),
  );
}

export function getTeamsForAgent(agentId: string) {
  const agent = agentsById.get(agentId);
  if (!agent) {
    return [];
  }

  return cloneRecords(
    agent.teamIds
      .map((teamId) => teamsById.get(teamId))
      .filter((team): team is Team => Boolean(team)),
  );
}

export function getAgentsForSkill(skillId: string) {
  return cloneRecords(
    catalogStore.agents.filter((agent) => agent.skillIds.includes(skillId)),
  );
}

export function getAgentsForTool(toolId: string) {
  return cloneRecords(
    catalogStore.agents.filter((agent) => agent.toolIds.includes(toolId)),
  );
}

export function getSettingsPreviewSections() {
  return cloneRecords(catalogStore.settingsPreviewSections);
}
