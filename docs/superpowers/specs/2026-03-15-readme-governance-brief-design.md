# README Governance Brief Refresh Design

## Goal
Refresh `README.md` into a technical governance brief that reflects the latest implemented capabilities (coordinator/planner-first project coordination, multi-backend PI runtime adapters, hardened operator surfaces, and unified project work management), while keeping a positive, marketing-forward tone and the current overall structure.

## Audience
Decision-makers who need a clear, accurate snapshot of SPORE’s governance model, execution flow, and operator visibility without diving into the full docs catalog.

## Scope
- Update key sections in-place (no full README rewrite):
  - “What’s New”
  - Architecture diagram annotations and text
  - “How It Works” flow
  - “Project Work Management” flow
  - “Role System” emphasis on coordinator/planner/integrator
  - “Operator Surfaces” highlights
  - “Docs / Roadmap” pointers (light refresh)
- Tone: positive and precise; avoid limitation/disclaimer sections.
- Source of truth: recent commits and implemented behavior; avoid relying on potentially stale narrative docs.

## Content Updates (Planned)
1. **What’s New**
   - Multi-backend PI runtime adapters: `pi_rpc`, `pi_sdk_embedded`, `pi_sdk_worker`.
   - Planner-first coordinator flow and explicit project coordination root.
   - Unified project work management (self-build as a special case).
   - Operator surfaces: Agent Cockpit as default home, Mission Map family rooting, Operator Chat integration.
   - Hardening: handoff validation, rooted execution trees, governance-ready promotion flow.

2. **Architecture Section**
   - Emphasize coordinator → planner → lead lanes → integrator promotion lane.
   - Highlight runtime-core + runtime-pi adapter boundary and artifact parity.
   - Reinforce execution trees, rooted lineage, and governance stop points.

3. **How It Works**
   - Replace generic flow with planner-first project coordination flow.
   - Explicitly note adoption of `coordination_plan` before dispatch.

4. **Project Work Management**
   - Unification narrative: same pipeline for any project, SPORE is the reference case.
   - Approval vs promotion separation; promotion lane via integrator.

5. **Role System**
   - Make coordinator + planner roles explicit and central.
   - Preserve integrator as promotion boundary.

6. **Operator Surfaces**
   - Agent Cockpit as default landing and mission-control home.
   - Mission Map rooted by execution trees.

7. **Docs / Roadmap**
   - Light updates only; avoid “limitations”.

## Success Criteria
- README accurately reflects current implemented flows and runtime modes from recent commits.
- Coordinator/planner-first project flow is visible in at least two sections.
- Positive, decision-maker friendly tone with technical specificity.
- Minimal structural churn; existing anchors remain valid.
