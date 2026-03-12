// ========================
// SPORE Mock Data
// ========================

export type Status =
  | "active" | "inactive" | "running" | "completed" | "needs-review"
  | "needs-approval" | "held" | "blocked" | "rejected"
  | "validation-pending" | "promotion-ready" | "promotion-blocked" | "quarantined";

export interface Space {
  id: string;
  name: string;
  description: string;
  projectCount: number;
  status: Status;
  lastActivity: string;
}

export interface Project {
  id: string;
  name: string;
  repo: string;
  spaceId: string;
  spaceName: string;
  teamIds: string[];
  workflowIds: string[];
  status: Status;
  pendingApprovals: number;
  recentProposals: number;
  description: string;
}

export interface Team {
  id: string;
  name: string;
  purpose: string;
  agentIds: string[];
  projectIds: string[];
  status: Status;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  skillIds: string[];
  toolIds: string[];
  teamIds: string[];
  guardrails: string[];
  status: Status;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  agentIds: string[];
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  restrictions: string[];
  agentIds: string[];
}

export interface WorkflowStage {
  id: string;
  name: string;
  order: number;
  purpose: string;
  hasGovernance: boolean;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  stages: WorkflowStage[];
  projectIds: string[];
  teamIds: string[];
  status: Status;
}

export type MessageType =
  | "operator" | "goal" | "proposal" | "approval-request" | "rejection"
  | "validation" | "workflow-status" | "warning" | "blocker"
  | "recommendation" | "reference" | "system";

export interface ChatMessage {
  id: string;
  type: MessageType;
  content: string;
  timestamp: string;
  meta?: Record<string, string>;
  actions?: Array<{ label: string; variant: "approve" | "reject" | "rework" | "hold" | "promote" | "default" }>;
}

export interface ChatThread {
  id: string;
  title: string;
  projectId?: string;
  projectName?: string;
  spaceName?: string;
  status: Status;
  unread: boolean;
  lastMessage: string;
  lastTimestamp: string;
  messages: ChatMessage[];
  pendingActions: number;
  currentStage?: string;
  linkedArtifacts?: Array<{ type: string; label: string; status: Status }>;
}

// ── Spaces ──
export const spaces: Space[] = [
  { id: "sp-1", name: "Platform Core", description: "Core platform services and infrastructure", projectCount: 3, status: "active", lastActivity: "2 min ago" },
  { id: "sp-2", name: "Data Pipeline", description: "ETL, streaming, and data lake management", projectCount: 2, status: "active", lastActivity: "15 min ago" },
  { id: "sp-3", name: "Customer Portal", description: "Customer-facing web and mobile applications", projectCount: 2, status: "needs-review", lastActivity: "1 hr ago" },
  { id: "sp-4", name: "Internal Tools", description: "Developer productivity and internal tooling", projectCount: 1, status: "inactive", lastActivity: "3 days ago" },
];

// ── Skills ──
export const skills: Skill[] = [
  { id: "sk-1", name: "Code Generation", description: "Generate code from specifications and design docs", category: "Development", agentIds: ["ag-1", "ag-2"] },
  { id: "sk-2", name: "Code Review", description: "Analyze code for quality, security, and best practices", category: "Quality", agentIds: ["ag-3"] },
  { id: "sk-3", name: "Test Authoring", description: "Write unit, integration, and e2e tests", category: "Quality", agentIds: ["ag-2", "ag-3"] },
  { id: "sk-4", name: "Architecture Design", description: "Design system architecture and component boundaries", category: "Design", agentIds: ["ag-1"] },
  { id: "sk-5", name: "Documentation", description: "Generate and maintain technical documentation", category: "Documentation", agentIds: ["ag-4"] },
  { id: "sk-6", name: "Dependency Analysis", description: "Analyze and manage project dependencies", category: "Analysis", agentIds: ["ag-5"] },
  { id: "sk-7", name: "Security Scanning", description: "Scan for vulnerabilities and security issues", category: "Security", agentIds: ["ag-5"] },
  { id: "sk-8", name: "Performance Profiling", description: "Identify performance bottlenecks", category: "Analysis", agentIds: ["ag-6"] },
  { id: "sk-9", name: "Migration Planning", description: "Plan and execute codebase migrations", category: "Development", agentIds: ["ag-1", "ag-6"] },
  { id: "sk-10", name: "Incident Response", description: "Analyze and respond to production incidents", category: "Operations", agentIds: ["ag-6"] },
];

// ── Tools ──
export const tools: Tool[] = [
  { id: "tl-1", name: "GitHub API", description: "Create PRs, manage branches, read repo metadata", riskLevel: "medium", restrictions: ["Rate-limited", "Scoped to org repos"], agentIds: ["ag-1", "ag-2", "ag-3"] },
  { id: "tl-2", name: "File System", description: "Read and write files in managed workspaces", riskLevel: "high", restrictions: ["Sandboxed workspace only", "No system paths"], agentIds: ["ag-1", "ag-2"] },
  { id: "tl-3", name: "Terminal", description: "Execute shell commands in sandboxed environment", riskLevel: "critical", restrictions: ["Allowlisted commands", "Timeout enforced", "No network access"], agentIds: ["ag-1"] },
  { id: "tl-4", name: "Search Index", description: "Full-text search across codebase and docs", riskLevel: "low", restrictions: [], agentIds: ["ag-3", "ag-4", "ag-5"] },
  { id: "tl-5", name: "Package Registry", description: "Query npm, PyPI, and other package registries", riskLevel: "low", restrictions: ["Read-only"], agentIds: ["ag-5"] },
  { id: "tl-6", name: "CI/CD Pipeline", description: "Trigger and monitor CI/CD pipeline runs", riskLevel: "high", restrictions: ["Requires approval for production", "Audit logged"], agentIds: ["ag-6"] },
  { id: "tl-7", name: "Metrics API", description: "Query application and infrastructure metrics", riskLevel: "low", restrictions: ["Read-only"], agentIds: ["ag-6"] },
  { id: "tl-8", name: "Notification Service", description: "Send notifications to operators and channels", riskLevel: "medium", restrictions: ["Rate-limited", "Template-based"], agentIds: ["ag-4"] },
];

// ── Agents ──
export const agents: Agent[] = [
  { id: "ag-1", name: "Architect", description: "Designs system architecture, plans implementations, generates scaffolding code", skillIds: ["sk-1", "sk-4", "sk-9"], toolIds: ["tl-1", "tl-2", "tl-3"], teamIds: ["tm-1"], guardrails: ["Must produce design doc before code", "Cannot modify production configs"], status: "active" },
  { id: "ag-2", name: "Implementer", description: "Writes production code following approved designs and specifications", skillIds: ["sk-1", "sk-3"], toolIds: ["tl-1", "tl-2"], teamIds: ["tm-1", "tm-2"], guardrails: ["Must follow approved design", "Max 500 LOC per PR"], status: "running" },
  { id: "ag-3", name: "Reviewer", description: "Reviews code for quality, correctness, security, and adherence to standards", skillIds: ["sk-2", "sk-3"], toolIds: ["tl-1", "tl-4"], teamIds: ["tm-1"], guardrails: ["Cannot approve own work", "Must check test coverage"], status: "active" },
  { id: "ag-4", name: "Documenter", description: "Maintains technical docs, API references, and changelog entries", skillIds: ["sk-5"], toolIds: ["tl-4", "tl-8"], teamIds: ["tm-2"], guardrails: ["Must link to source code", "Follow doc templates"], status: "active" },
  { id: "ag-5", name: "Guardian", description: "Scans for security vulnerabilities, dependency risks, and compliance issues", skillIds: ["sk-6", "sk-7"], toolIds: ["tl-4", "tl-5"], teamIds: ["tm-3"], guardrails: ["Must report all critical findings", "Cannot suppress warnings"], status: "active" },
  { id: "ag-6", name: "Operator", description: "Manages deployments, monitors health, responds to incidents", skillIds: ["sk-8", "sk-9", "sk-10"], toolIds: ["tl-6", "tl-7"], teamIds: ["tm-3"], guardrails: ["Production changes require approval", "Must maintain rollback plan"], status: "active" },
];

// ── Teams ──
export const teams: Team[] = [
  { id: "tm-1", name: "Core Engineering", purpose: "Build and maintain core platform features", agentIds: ["ag-1", "ag-2", "ag-3"], projectIds: ["pj-1", "pj-2"], status: "active" },
  { id: "tm-2", name: "Content & Docs", purpose: "Documentation, changelogs, and knowledge management", agentIds: ["ag-2", "ag-4"], projectIds: ["pj-3"], status: "active" },
  { id: "tm-3", name: "Security & Ops", purpose: "Security scanning, compliance, deployment, and monitoring", agentIds: ["ag-5", "ag-6"], projectIds: ["pj-1", "pj-4"], status: "active" },
  { id: "tm-4", name: "Data Team", purpose: "Data pipeline development and maintenance", agentIds: ["ag-1", "ag-2"], projectIds: ["pj-5"], status: "active" },
];

// ── Projects ──
export const projects: Project[] = [
  { id: "pj-1", name: "spore-orchestrator", repo: "github.com/org/spore-orchestrator", spaceId: "sp-1", spaceName: "Platform Core", teamIds: ["tm-1", "tm-3"], workflowIds: ["wf-1", "wf-2"], status: "running", pendingApprovals: 2, recentProposals: 3, description: "Central orchestration engine for SPORE" },
  { id: "pj-2", name: "spore-api-gateway", repo: "github.com/org/spore-api-gateway", spaceId: "sp-1", spaceName: "Platform Core", teamIds: ["tm-1"], workflowIds: ["wf-1"], status: "needs-approval", pendingApprovals: 1, recentProposals: 1, description: "API gateway and routing layer" },
  { id: "pj-3", name: "spore-docs", repo: "github.com/org/spore-docs", spaceId: "sp-1", spaceName: "Platform Core", teamIds: ["tm-2"], workflowIds: ["wf-3"], status: "active", pendingApprovals: 0, recentProposals: 2, description: "Public documentation site" },
  { id: "pj-4", name: "customer-dashboard", repo: "github.com/org/customer-dashboard", spaceId: "sp-3", spaceName: "Customer Portal", teamIds: ["tm-3"], workflowIds: ["wf-1"], status: "needs-review", pendingApprovals: 1, recentProposals: 1, description: "Customer-facing analytics dashboard" },
  { id: "pj-5", name: "data-ingest-service", repo: "github.com/org/data-ingest", spaceId: "sp-2", spaceName: "Data Pipeline", teamIds: ["tm-4"], workflowIds: ["wf-2"], status: "blocked", pendingApprovals: 0, recentProposals: 0, description: "Real-time data ingestion microservice" },
  { id: "pj-6", name: "stream-processor", repo: "github.com/org/stream-processor", spaceId: "sp-2", spaceName: "Data Pipeline", teamIds: ["tm-4"], workflowIds: ["wf-2"], status: "active", pendingApprovals: 0, recentProposals: 1, description: "Stream processing engine" },
];

// ── Workflows ──
export const workflows: Workflow[] = [
  {
    id: "wf-1", name: "Standard Delivery", description: "Full software delivery lifecycle with governance gates",
    stages: [
      { id: "ws-1", name: "Goal Planning", order: 1, purpose: "Define objectives and acceptance criteria", hasGovernance: false },
      { id: "ws-2", name: "Design", order: 2, purpose: "Architecture and technical design review", hasGovernance: true },
      { id: "ws-3", name: "Implementation", order: 3, purpose: "Code generation and feature development", hasGovernance: false },
      { id: "ws-4", name: "Validation", order: 4, purpose: "Testing, review, and security scanning", hasGovernance: true },
      { id: "ws-5", name: "Promotion", order: 5, purpose: "Staging deployment and final approval", hasGovernance: true },
      { id: "ws-6", name: "Release", order: 6, purpose: "Production deployment and monitoring", hasGovernance: true },
    ],
    projectIds: ["pj-1", "pj-2", "pj-4"], teamIds: ["tm-1", "tm-3"], status: "active",
  },
  {
    id: "wf-2", name: "Fast Track", description: "Expedited delivery for low-risk changes",
    stages: [
      { id: "ws-7", name: "Planning", order: 1, purpose: "Quick goal and scope definition", hasGovernance: false },
      { id: "ws-8", name: "Build & Test", order: 2, purpose: "Implementation with inline validation", hasGovernance: false },
      { id: "ws-9", name: "Review & Ship", order: 3, purpose: "Final review and deployment", hasGovernance: true },
    ],
    projectIds: ["pj-1", "pj-5", "pj-6"], teamIds: ["tm-1", "tm-4"], status: "active",
  },
  {
    id: "wf-3", name: "Documentation Only", description: "Content updates with editorial review",
    stages: [
      { id: "ws-10", name: "Drafting", order: 1, purpose: "Content creation and initial review", hasGovernance: false },
      { id: "ws-11", name: "Editorial Review", order: 2, purpose: "Technical accuracy and style review", hasGovernance: true },
      { id: "ws-12", name: "Publish", order: 3, purpose: "Deploy to documentation site", hasGovernance: false },
    ],
    projectIds: ["pj-3"], teamIds: ["tm-2"], status: "active",
  },
];

// ── Chat Threads ──
export const chatThreads: ChatThread[] = [
  {
    id: "th-1",
    title: "Implement OAuth2 PKCE flow",
    projectId: "pj-1", projectName: "spore-orchestrator", spaceName: "Platform Core",
    status: "needs-approval",
    unread: true,
    lastMessage: "Proposal ready for governance review",
    lastTimestamp: "2 min ago",
    pendingActions: 2,
    currentStage: "Validation",
    linkedArtifacts: [
      { type: "Goal Plan", label: "OAuth2 PKCE Implementation", status: "completed" },
      { type: "Proposal", label: "PR #247 — Auth module refactor", status: "needs-approval" },
      { type: "Validation", label: "Security scan passed", status: "completed" },
      { type: "Validation", label: "Integration tests — 94% pass", status: "needs-review" },
    ],
    messages: [
      { id: "m-1", type: "operator", content: "Start implementing OAuth2 PKCE flow for the orchestrator API. We need to replace the current basic auth.", timestamp: "10:14 AM" },
      { id: "m-2", type: "goal", content: "Goal Plan Created", timestamp: "10:14 AM", meta: { title: "Implement OAuth2 PKCE Flow", scope: "Replace basic auth with OAuth2 PKCE on all API endpoints", acceptance: "All endpoints authenticated via PKCE, backward-compatible session migration, security scan clean" } },
      { id: "m-3", type: "workflow-status", content: "Workflow started: Standard Delivery", timestamp: "10:15 AM", meta: { workflow: "Standard Delivery", stage: "Design", project: "spore-orchestrator" } },
      { id: "m-4", type: "proposal", content: "Design Proposal Ready", timestamp: "10:32 AM", meta: { title: "Auth Module Refactor — Design Doc", summary: "Replace BasicAuthMiddleware with PKCE flow. New TokenService, AuthCodeStore, and PKCE verifier. Backward-compatible session bridge for 30-day migration.", files: "7 files, +420 −180 lines", pr: "PR #247" } },
      { id: "m-5", type: "approval-request", content: "Design approval required before implementation begins.", timestamp: "10:33 AM", meta: { decision: "Approve design to proceed to implementation", risk: "Medium — auth changes affect all API consumers" }, actions: [{ label: "Approve", variant: "approve" }, { label: "Reject", variant: "reject" }, { label: "Request Rework", variant: "rework" }] },
      { id: "m-6", type: "operator", content: "Design looks solid. Approved. Make sure the session bridge handles edge cases with expired tokens.", timestamp: "10:45 AM" },
      { id: "m-7", type: "workflow-status", content: "Moving to Implementation phase", timestamp: "10:45 AM", meta: { stage: "Implementation", progress: "60%" } },
      { id: "m-8", type: "validation", content: "Validation Results", timestamp: "11:20 AM", meta: { tests: "142 passed, 9 failed", coverage: "87%", security: "No critical findings", performance: "Auth latency +12ms (acceptable)" } },
      { id: "m-9", type: "warning", content: "9 test failures detected in legacy integration suite. Review needed.", timestamp: "11:21 AM", meta: { category: "Test Failures", detail: "Legacy session tests expect BasicAuth headers. Need migration." } },
      { id: "m-10", type: "approval-request", content: "Promotion to staging requires approval. 9 legacy test failures flagged.", timestamp: "11:22 AM", meta: { decision: "Approve promotion with known legacy failures or request rework", risk: "Low — failures are in deprecated test suite" }, actions: [{ label: "Approve Promotion", variant: "promote" }, { label: "Hold", variant: "hold" }, { label: "Request Rework", variant: "rework" }] },
    ],
  },
  {
    id: "th-2",
    title: "Upgrade data pipeline to Kafka 3.7",
    projectId: "pj-5", projectName: "data-ingest-service", spaceName: "Data Pipeline",
    status: "blocked",
    unread: true,
    lastMessage: "Blocked: incompatible serializer in consumer group",
    lastTimestamp: "18 min ago",
    pendingActions: 1,
    currentStage: "Implementation",
    linkedArtifacts: [
      { type: "Goal Plan", label: "Kafka 3.7 Upgrade", status: "completed" },
      { type: "Blocker", label: "Serializer incompatibility", status: "blocked" },
    ],
    messages: [
      { id: "m-20", type: "operator", content: "Upgrade data-ingest-service to Kafka 3.7. Current 3.4 has known memory leak.", timestamp: "9:00 AM" },
      { id: "m-21", type: "goal", content: "Goal Plan Created", timestamp: "9:01 AM", meta: { title: "Kafka 3.7 Upgrade", scope: "Upgrade Kafka client, update serializers, run compatibility tests", acceptance: "Zero-downtime upgrade, no data loss" } },
      { id: "m-22", type: "blocker", content: "Blocker Detected", timestamp: "9:45 AM", meta: { title: "Serializer Incompatibility", detail: "ConsumerGroup 'ingest-primary' uses deprecated AvroSerializer v1 which is removed in Kafka 3.7. Must migrate to v2 before upgrade.", impact: "Cannot proceed without serializer migration" } },
    ],
  },
  {
    id: "th-3",
    title: "Add rate limiting to API gateway",
    projectId: "pj-2", projectName: "spore-api-gateway", spaceName: "Platform Core",
    status: "running",
    unread: false,
    lastMessage: "Implementation in progress — 3 of 5 endpoints done",
    lastTimestamp: "45 min ago",
    pendingActions: 0,
    currentStage: "Implementation",
    linkedArtifacts: [
      { type: "Goal Plan", label: "Rate Limiting Implementation", status: "completed" },
      { type: "Workflow", label: "Standard Delivery — Stage 3/6", status: "running" },
    ],
    messages: [
      { id: "m-30", type: "operator", content: "Add token-bucket rate limiting to the API gateway. Start with the 5 highest-traffic endpoints.", timestamp: "8:30 AM" },
      { id: "m-31", type: "goal", content: "Goal Plan Created", timestamp: "8:31 AM", meta: { title: "API Gateway Rate Limiting", scope: "Token-bucket rate limiter on top 5 endpoints", acceptance: "Configurable per-endpoint limits, Redis-backed, 429 responses with retry-after headers" } },
      { id: "m-32", type: "workflow-status", content: "Implementation in progress", timestamp: "9:15 AM", meta: { stage: "Implementation", progress: "60%", detail: "3 of 5 endpoints complete" } },
    ],
  },
  {
    id: "th-4",
    title: "Update API reference documentation",
    projectId: "pj-3", projectName: "spore-docs", spaceName: "Platform Core",
    status: "completed",
    unread: false,
    lastMessage: "Documentation published successfully",
    lastTimestamp: "2 hrs ago",
    pendingActions: 0,
    currentStage: "Publish",
    linkedArtifacts: [
      { type: "Goal Plan", label: "API Reference Update", status: "completed" },
    ],
    messages: [
      { id: "m-40", type: "operator", content: "Update the API reference docs to reflect the new v3 endpoints.", timestamp: "7:00 AM" },
      { id: "m-41", type: "system", content: "Documentation published to docs.spore.dev", timestamp: "8:30 AM" },
    ],
  },
  {
    id: "th-5",
    title: "Security audit for customer dashboard",
    projectId: "pj-4", projectName: "customer-dashboard", spaceName: "Customer Portal",
    status: "needs-review",
    unread: true,
    lastMessage: "2 high-severity findings require review",
    lastTimestamp: "1 hr ago",
    pendingActions: 1,
    currentStage: "Validation",
    linkedArtifacts: [
      { type: "Validation", label: "Security Scan — 2 high findings", status: "needs-review" },
      { type: "Validation", label: "Dependency audit — 1 critical CVE", status: "needs-review" },
    ],
    messages: [
      { id: "m-50", type: "operator", content: "Run a full security audit on the customer dashboard before the Q1 release.", timestamp: "8:00 AM" },
      { id: "m-51", type: "validation", content: "Security Scan Complete", timestamp: "9:15 AM", meta: { tests: "247 checks", security: "2 high, 4 medium, 12 low findings", detail: "XSS vulnerability in chart tooltip, CSRF token not rotating on session refresh" } },
      { id: "m-52", type: "approval-request", content: "Review required: 2 high-severity security findings", timestamp: "9:16 AM", meta: { decision: "Approve with remediation plan or block release", risk: "High — XSS and CSRF vulnerabilities in production path" }, actions: [{ label: "Approve with Plan", variant: "approve" }, { label: "Block Release", variant: "reject" }, { label: "Request Rework", variant: "rework" }] },
    ],
  },
];

// Helper to get entities by ID
export const getSpace = (id: string) => spaces.find(s => s.id === id);
export const getProject = (id: string) => projects.find(p => p.id === id);
export const getTeam = (id: string) => teams.find(t => t.id === id);
export const getAgent = (id: string) => agents.find(a => a.id === id);
export const getSkill = (id: string) => skills.find(s => s.id === id);
export const getTool = (id: string) => tools.find(t => t.id === id);
export const getWorkflow = (id: string) => workflows.find(w => w.id === id);
export const getThread = (id: string) => chatThreads.find(t => t.id === id);
