# ADR-0005: Use Snapshot-Based Builder and Tester Verification Workspaces

- Status: Accepted
- Date: 2026-03-09

## Context

SPORE now provisions git worktrees for mutating self-work and selected workflow steps. The canonical implementation workflows previously allowed builder and tester to run in the same final verification wave, which risked sharing one mutable checkout and producing non-deterministic verification evidence.

That model is weak for reviewable self-build work because:

- tester results can depend on the builder's live mutable filesystem,
- authorship and mutation ownership become unclear,
- proposal review loses a stable snapshot to validate,
- cleanup and recovery become harder because one workspace carries two different responsibilities.

## Decision

For the canonical implementation workflows, final verification is now sequential and snapshot-based:

- builder owns an authoring workspace,
- builder publishes a git-backed handoff snapshot,
- tester receives a separate verification workspace created from that snapshot,
- reviewer remains read-only and consumes proposal plus verification evidence.

The repository also enforces a matching semantic validation rule:

- workflow step sets may not place `builder` and `tester` in the same final verification wave for the canonical implementation workflows.

## Consequences

- Final verification is reproducible against a frozen builder snapshot rather than a shared mutable checkout.
- Builder and tester now have explicit workspace-purpose semantics:
  - `authoring`
  - `verification`
- Runtime launch-context artifacts and session live payloads can prove the actual workspace `cwd` used by each step.
- Proposal artifacts can carry builder handoff snapshot metadata for later review and validation.
- Workflow templates and scenario documentation must keep builder/tester verification sequential unless a future explicit preflight tester mode is introduced.
