# Agent-to-Agent Communication Research

## Purpose

This note studies whether SPORE should eventually support direct or semi-direct agent-to-agent communication beyond the current orchestrator-driven handoff model.

It is not a commitment to implement such a feature now. It is a design reference for future brainstorming, ADR work, and phased implementation planning.

## Executive Takeaways

- SPORE already has coordination primitives, but not a true peer messaging layer.
- The current model is durable workflow state plus artifacts plus operator/orchestrator steering.
- Direct agent-to-agent communication can unlock cross-domain negotiation, clarification, and recovery flows that are awkward in a strictly hierarchical model.
- Reference systems suggest two distinct communication classes are useful:
  - durable asynchronous mail for messages that must survive session death,
  - ephemeral nudges for low-cost attention steering.
- The strongest recommendation for SPORE is not to add unrestricted free-form cross-talk.
- If SPORE adds this area later, it should start with narrow, policy-gated, auditable message types tied to executions, steps, and roles.

## SPORE Today

### What exists already

SPORE already supports coordination through:

- workflow steps and wave-based `stepSets`,
- execution lineage with `parentExecutionId`, `childExecutionIds`, `coordinationGroupId`, and `branchKey`,
- review and approval gates,
- escalation records and resume flows,
- proposal artifacts, workspace metadata, and git-backed handoff snapshots,
- operator and orchestrator steering through session controls.

In practice, one role informs another mostly by leaving durable state behind:

- builder produces code, workspace state, and proposal evidence,
- tester validates a snapshot,
- reviewer reads artifacts and records governance outcomes,
- coordinator and integrator consume execution-family metadata rather than chat between agents.

### What does not exist yet

SPORE does not currently expose a first-class inbox/outbox or peer messaging contract between agents.

There is no implemented equivalent today of:

- `agent A -> agent B` mailbox delivery,
- message threads between sibling domain leads,
- explicit broadcast to a coordination family,
- durable ask/reply semantics for one agent querying another,
- a policy model that decides which roles may talk to which other roles.

The docs mention `agent message events` as an event category goal, but the current executable slice focuses on session, workflow, review, approval, and escalation events rather than peer mail.

### What exists that looks similar

SPORE does have a limited "nudge-like" concept at the session control layer:

- `steer` and `follow_up` can be delivered to an active runtime session,
- the session gateway exposes steering routes,
- the orchestrator watchdog can automatically issue a `steer` on soft timeout.

This is useful, but it is not agent mail. It is a control plane from operator/orchestrator into a running session.

## Why SPORE Might Need This Later

### Good candidate use cases

Direct or semi-direct agent messaging becomes more attractive when work spans multiple active lanes that need local negotiation without always routing every detail through a single supervisor.

Examples:

1. Frontend lead asks backend lead for a contract decision
2. Builder asks tester to validate a concrete reproduction scenario
3. Reviewer asks builder for evidence that a specific risk was addressed
4. Integrator asks a domain lead to clarify whether a conflict is mechanical or semantic
5. Coordinator broadcasts a family-level architectural constraint to all active child lanes
6. One lane announces "API schema frozen" or "migration merged" to unblock others

### What it would add beyond current artifacts

Artifacts are good for completed outputs.

Messaging is better for:

- unanswered questions,
- negotiated decisions in progress,
- quick dependency unblock signals,
- requests for clarification,
- low-latency coordination between parallel lanes,
- preserving intent that would otherwise remain trapped in a transient session.

### Where the current model is weak

Without messaging, SPORE tends to force all cross-lane coordination into one of four buckets:

- indirect inference from artifacts,
- escalation to operator,
- orchestrator-driven replanning,
- ad hoc prompt steering.

That is acceptable for the current bootstrap scope, but could become awkward once project-root coordination and multi-domain implementation flows grow denser.

## What References Suggest

## Overstory

### Core model

Overstory implements a real agent mail system backed by SQLite in `.overstory/mail.db` with WAL mode for concurrent access.

Its mail model includes:

- sender and recipient,
- subject and body,
- priority,
- semantic or protocol type,
- optional thread id,
- optional structured payload,
- read/unread state,
- durable timestamps.

It distinguishes between:

- human-readable semantic types: `status`, `question`, `result`, `error`,
- structured protocol types: `worker_done`, `merge_ready`, `merged`, `merge_failed`, `escalation`, `health_check`, `dispatch`, `assign`.

### Injection model

Unread mail is not only stored; it is surfaced into the receiving agent's context on the next prompt cycle through hook injection.

That matters because a mailbox alone is not enough. The system also needs a delivery moment that the receiving agent will actually see.

### Nudge model

Overstory also has `nudge`, but it treats nudge separately from durable mail.

The notable pattern is:

- mail is durable and structured,
- nudge is lightweight attention-routing,
- pending nudges can be surfaced as a priority banner during the next injected mail check,
- watchdog flows use nudges to avoid heavy permanent-message overhead for routine status signals.

### Useful lessons for SPORE

- Separate durable coordination from lightweight attention steering.
- Typed messages are much safer than unrestricted free text.
- Hook or prompt-cycle injection is a practical delivery mechanism.
- Threading and structured payloads matter once messages become part of workflow state.
- Mail becomes most valuable when it is explicitly part of the orchestration model, not just a side database.

### Risks visible from Overstory

- The system gains another durable subsystem to maintain.
- A mailbox without strong policy can create uncontrolled side conversations.
- Prompt injection of unread mail increases context pressure and trust-surface size.
- Once agents can message freely, operators may lose clarity about the real decision path unless messages are tied back to runs and tasks.

## Gastown

### Core model

Gastown also has mail, but the more interesting lesson is that it sharply distinguishes when to use mail and when not to.

Its operating guidance repeatedly says, in effect:

- nudge for routine communication,
- mail only when the message must survive session death or participate in a formal protocol.

### Protocol orientation

Gastown's witness protocol classifies durable mail by subject and payload patterns such as:

- `HELP`,
- `MERGE_READY`,
- `MERGE_FAILED`,
- `MERGED`,
- `HANDOFF`,
- `SWARM_START`.

This means mail is not an open-ended chat room. It is mostly a protocol and escalation channel.

### Discover-don't-track lesson

Gastown has also evolved away from using mail for some things that were better represented as durable state elsewhere.

For example, completion discovery is treated as a bead/state observation problem rather than something that should rely purely on a `POLECAT_DONE` mail message.

That is highly relevant to SPORE.

It suggests a key rule:

- if the information is really workflow state, artifact state, or workspace state, store it there first,
- only use mail for requests, clarifications, escalations, and protocol notifications that are not better modeled as state transitions.

### Nudge model

Gastown uses nudges as the cheap, ephemeral mechanism for routine coordination:

- notify a worker about merge failure,
- poke refinery to check merge queue,
- avoid generating permanent commits for routine chatter.

### Useful lessons for SPORE

- Durable mail should be rare and meaningful.
- Routine status propagation should prefer cheap ephemeral signals.
- Many things that initially look like messages are actually better modeled as state discovery.
- Protocol-first message categories reduce chaos.

### Risks visible from Gastown

- If mail storage is expensive or noisy, agents will overproduce durable clutter.
- Operators need clear guidance about what belongs in state, mail, or nudge.
- Hybrid systems become confusing unless the boundaries are explicit.

## Agentic Engineering Book

### What the book says

The book does not prescribe one exact implementation, but it gives several strong signals:

- direct inter-agent communication becomes more relevant around larger swarms,
- mail-based protocols work well because they are asynchronous and persistent,
- convoy or shared tracking identifiers help multi-agent features avoid orphaned work,
- explicit file ownership remains the simplest coordination mechanism when possible,
- communication should be opt-in and capability-gated rather than assumed safe by default.

The book also highlights a safeguard pattern from another system: cross-talk disabled by default and allowlisted per agent pair.

### Useful lessons for SPORE

- Do not add agent communication until there is real coordination pressure.
- Default-off is the safer policy posture.
- File ownership and execution topology still do most of the coordination work.
- Messaging is an extra layer for edge cases and scale, not the primary foundation.

## Synthesis for SPORE

The references converge on a useful three-part model:

1. Durable state for execution facts
2. Durable mail for requests or protocol events that must survive
3. Ephemeral nudges for attention and timing

That division fits SPORE well.

SPORE already has a strong durable-state foundation. If this feature arrives later, it should extend that foundation rather than replace it.

## Recommended Design Direction for SPORE

### Recommendation in one sentence

If SPORE adds agent-to-agent communication later, prefer a narrow, execution-scoped, policy-gated mailbox plus lightweight nudges, not unrestricted free-form chat.

### Design principles

1. Default off
2. Execution-scoped, not global by default
3. Durable mail and ephemeral nudge are different primitives
4. Typed messages before free-form messages
5. State first, message second
6. Auditable by operator surfaces
7. Explicit allowlists by role pair or workflow

### Recommended capability layers

#### Layer A: No peer messaging

Keep the current model:

- artifacts,
- review/approval,
- escalations,
- operator/orchestrator steering.

This should remain the default for many workflows.

#### Layer B: Attention nudges

Add a cheap, non-durable or lightly durable signal such as:

- `nudge execution/step/session`,
- `nudge role in coordination family`,
- `nudge all active children in family`.

Possible semantics:

- no reply required,
- short message only,
- TTL or debounce,
- visible in live history but not treated as formal workflow evidence.

This is the smallest useful expansion and likely the safest first step.

#### Layer C: Typed ask/reply mail

Add structured messages with explicit kinds, for example:

- `question`,
- `answer`,
- `request_evidence`,
- `decision_request`,
- `dependency_ready`,
- `handoff_notice`,
- `escalation_notice`.

Recommended fields:

- `id`
- `threadId`
- `executionId`
- `stepId`
- `coordinationGroupId`
- `fromRole`
- `fromExecutionId`
- `toRole` or `toExecutionId`
- `kind`
- `subject`
- `body`
- `payload`
- `priority`
- `status` (`pending`, `read`, `answered`, `closed`, `expired`)
- `requiresResponse`
- `expiresAt`
- `createdAt`
- `readAt`
- `answeredAt`

This would support the frontend-lead to backend-lead case without turning the system into a chat app.

#### Layer D: Broadcast and family coordination

Possible later additions:

- broadcast to all active executions in a coordination group,
- publish a family-level coordination note,
- notify all waiting children that one dependency lane is complete,
- one-to-many decision propagation with acknowledgement tracking.

This should only come after point-to-point semantics are stable.

## Recommended Boundaries

### Who should be allowed to talk to whom

A safe initial policy would be explicit allowlists by workflow and role pair.

Examples:

- `lead <-> lead` inside one `coordinationGroupId`
- `reviewer -> builder` for evidence requests
- `integrator -> lead` for conflict clarification
- `coordinator -> any child` as broadcast or direct ask
- not allowed by default: `builder <-> builder` across unrelated executions

### What should stay out of messaging

Do not use mail for:

- execution completion state,
- review or approval verdicts,
- workspace allocation facts,
- proposal artifact existence,
- branch lineage,
- retry counts,
- terminal execution status.

Those belong in existing orchestrator/session/workspace stores.

### Delivery model recommendation

If mail is added, SPORE likely needs both:

- a durable store and API surface,
- a controlled delivery mechanism into agent runtime context.

Reasonable delivery choices:

1. inject unread messages into the next prompt cycle,
2. deliver as runtime `follow_up` or `prompt` when the recipient session is active,
3. leave unread mail in the store when no active session exists.

The right approach may vary by runtime mode.

## What This Could Enable in SPORE

### Positive outcomes

- less operator micromanagement for cross-domain clarification,
- fewer escalations that are really just local questions,
- better coordination in project-root families,
- durable record of why a cross-lane decision happened,
- cleaner handling of long-lived multi-execution work,
- a future substrate for richer autonomous coordination.

### Strategic upside

This could become especially useful once SPORE has more of the following active at once:

- multiple parallel domain leads,
- explicit coordinator-root project families,
- promotion lanes with integrator feedback loops,
- managed work-item groups with several concurrent runs,
- longer-lived sessions where timing mismatches become common.

## Main Risks and Failure Modes

### 1. Cross-talk explosion

If any agent can message any other agent, the system may drift from explicit workflow topology into opaque conversational sprawl.

### 2. Context pollution

Injecting too much peer chatter into prompts can degrade focus, increase token cost, and create accidental prompt-injection surface.

### 3. Wrong abstraction

Many "messages" are really latent workflow states. If mail becomes a substitute for proper state modeling, the architecture gets weaker.

### 4. Hidden decision paths

If architectural or governance decisions happen only inside agent messages, operators may lose a clear canonical decision trail.

### 5. Security and trust

Peer messages are an internal prompt-ingestion surface. They need the same suspicion as any other untrusted context source.

### 6. Deadlocks and waiting cycles

Agents can block each other by waiting for answers that never arrive unless timeouts, escalation rules, and ownership semantics are explicit.

### 7. Incentive drift

Agents may start asking peers for things they should infer from docs, artifacts, or read surfaces, increasing noise.

## Guardrails SPORE Should Probably Require

- default-off communication policy,
- explicit allowlists by workflow, role pair, or execution relationship,
- typed message kinds with schema validation,
- message size limits,
- operator-visible audit trail,
- TTL and stale-message handling,
- rate limits or debounce for nudges,
- escalation path when a required reply is missing,
- clear distinction between governance records and chat-like coordination,
- per-runtime sanitization rules before injecting peer content into prompts.

## Suggested SPORE Architecture Shape

### Minimum durable model

If implemented later, a first SPORE message model could look like:

- `agent_messages` table for durable ask/reply records,
- `agent_nudges` table or event-only contract for short-lived nudges,
- message events in execution history,
- optional links from messages to execution, step, workspace, proposal, or escalation artifacts,
- HTTP routes and CLI commands for read/send/reply/close.

### Good integration points

- `packages/orchestrator/` as the durable execution-aware message authority,
- `services/orchestrator/` for message read/write APIs,
- `packages/session-manager/` and `services/session-gateway/` for runtime delivery or control bridging,
- `packages/tui/` and `apps/web/` for operator inspection of message threads in execution detail views.

### Message/event relationship

Recommended event families if this is implemented:

- `workflow.message.sent`
- `workflow.message.delivered`
- `workflow.message.read`
- `workflow.message.answered`
- `workflow.message.expired`
- `workflow.nudge.sent`
- `workflow.nudge.acknowledged`

These should remain additive and optional, consistent with the current event model style.

## Phased Implementation Options

### Option 0: Do nothing now

Best if:

- current workflows are still mostly linear,
- cross-domain negotiation is rare,
- operator steering is sufficient,
- implementation complexity would outrun near-term value.

This is the recommended short-term default.

### Option 1: Add only nudges

Add family-aware nudge support without durable ask/reply mail.

Benefits:

- low complexity,
- useful for attention routing,
- aligns with existing `steer` and `follow_up` concepts,
- avoids creating a heavy mailbox subsystem too early.

Risks:

- not enough for durable question/answer flows,
- can devolve into ad hoc chatter if poorly constrained.

### Option 2: Add typed ask/reply within one coordination family

Benefits:

- directly solves the lead-to-lead clarification case,
- keeps blast radius bounded,
- makes cross-domain negotiation auditable.

Risks:

- requires schema, APIs, UI/TUI inspection, runtime delivery, and timeout policy,
- introduces a new class of execution waiting behavior.

This is the best first real mailbox option if demand appears.

### Option 3: Full mailbox with broadcast and routing rules

Benefits:

- strongest flexibility,
- closer to Overstory or Gastown capabilities.

Risks:

- highest complexity,
- easiest to misuse,
- greatest risk of replacing explicit workflow design with conversations.

Not recommended as a first implementation slice.

## Recommended Future Path

If SPORE revisits this topic later, the recommended order is:

1. confirm real pain points from actual coordinator-root and integrator flows,
2. add a small ADR defining what counts as state vs mail vs nudge,
3. if needed, implement family-scoped nudges first,
4. only then consider typed ask/reply mail between allowlisted role pairs,
5. keep free-form unrestricted messaging out of scope unless proven necessary.

## Open Questions for Future Brainstorming

- Should a message belong to a session, a step, an execution, or only a coordination family?
- Should delivery into active sessions use prompt injection, runtime follow-up, or both?
- How should unanswered questions block workflow progress, if at all?
- Should reviewer-to-builder evidence requests remain messages, or become a formal execution sub-state?
- Should cross-domain lead discussions produce a required durable decision artifact after resolution?
- How should message trust and sanitization work when prompts ingest peer-authored content?
- Is a convoy-like shared tracking identifier needed beyond `coordinationGroupId`?

## Bottom Line

SPORE does not need a full mail system today.

But the idea is valid for the future, especially for project-root multi-domain coordination.

The best-fit SPORE version would likely be:

- default-off,
- execution-scoped,
- typed and auditable,
- split into durable mail plus lightweight nudges,
- deliberately narrow so workflow state remains the primary coordination substrate.
