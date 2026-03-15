# README Governance Brief Update Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `README.md` to reflect the latest governance-oriented project state and flows (coordinator/planner-first, multi-backend runtime, hardened operator surfaces) with a positive, decision-maker-friendly tone.

**Architecture:** Preserve the current README structure and update specific sections in place to reflect recent commits (flows, roles, runtime backends, operator surfaces). Avoid adding limitations; emphasize governance and execution lineage.

**Tech Stack:** Markdown

---

## File Structure

- Modify: `README.md`
- Reference: `docs/superpowers/specs/2026-03-15-readme-governance-brief-design.md`

## Chunk 1: README Content Updates

### Task 1: Refresh “What’s New” with latest commit-backed changes

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Draft the new bullet list**

Include explicit mentions of:
- multi-backend PI runtime adapters (`pi_rpc`, `pi_sdk_embedded`, `pi_sdk_worker`),
- planner-first coordinator flow and project coordination root,
- unified project work management (self-build as a special case),
- agent cockpit as default home with mission map rooting and operator chat,
- hardening: execution trees, handoff validation, promotion lane clarity.

- [ ] **Step 2: Apply edits to the “What’s New” section**

Update the existing bullets without changing anchors.

- [ ] **Step 3: Review for tone and accuracy**

Ensure the language is positive and grounded in recent commit changes.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: refresh README highlights for governance flow"
```

### Task 2: Update architecture and flow descriptions to coordinator/planner-first

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Architecture section annotations**

Emphasize:
- coordinator root as family anchor,
- planner lane as default first step,
- integrator as promotion lane.
- runtime-core + runtime-pi adapter boundary and artifact parity.

- [ ] **Step 2: Update “How It Works” to show planner-first flow**

Insert a project coordination flow using:
`objective -> coordinator -> planner -> adopt coordination_plan -> dispatch -> leads -> integrator`.

- [ ] **Step 3: Update “Project Work Management” to reflect unification**

Explicitly frame the pipeline as generic with SPORE as the reference case; highlight approval vs promotion separation.

- [ ] **Step 4: Commit (optional)**

```bash
git add README.md
git commit -m "docs: align README flow with coordinator planner-first model"
```

### Task 3: Refresh role system and operator surfaces

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Role System text**

Make coordinator + planner explicit and central; keep integrator as promotion boundary.

- [ ] **Step 2: Update Operator Surfaces highlights**

State Agent Cockpit as default landing; highlight Mission Map rooted by execution trees and Operator Chat integration.

- [ ] **Step 3: Quick scan for consistency**

Verify references to runtime modes and operator surfaces align with earlier sections.

- [ ] **Step 4: Commit (optional)**

```bash
git add README.md
git commit -m "docs: refresh README roles and operator surface narrative"
```

### Task 4: Light docs/roadmap pointer refresh

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Review “Docs” and “Roadmap” references**

Ensure links still reflect current documents; avoid adding limitation language.

- [ ] **Step 2: Commit (optional)**

```bash
git add README.md
git commit -m "docs: tidy README documentation pointers"
```
