# Operator Chat UX Polish Design

## Intent

Turn SPORE's existing operator chat into a guided mission console that feels simple, modern, and trustworthy for first-time operators while preserving the durable governance model underneath.

## Problem

The current operator chat already works functionally, but it still feels too much like a technical control panel. The operator can complete the flow, yet the interface still exposes too much backend structure and too little plain-language guidance.

The target experience is:

- operator states a mission once,
- SPORE translates that into self-build artifacts,
- SPORE keeps moving automatically,
- SPORE only interrupts when a real decision is needed,
- the operator always knows what is happening and what the next best action is.

## Product Goal

Make `Operator Chat` the most intuitive place to control SPORE self-build in the browser.

That means:

- a strong first-mission flow,
- clear visual hierarchy,
- one obvious next action,
- secondary access to evidence and artifacts,
- a polished mission-control visual language.

## Non-Goals

- replacing goal plans, proposals, validation, or promotion as durable artifacts,
- removing governance gates,
- building a different chat system separate from orchestrator state,
- redesigning the entire app outside the Operator Chat surface.

## Chosen UX Direction

The chosen direction is `Guided Mission Console`.

The chat surface should feel like one guided operational flow rather than a set of loosely related panels. The operator should first understand:

1. what mission is active,
2. what SPORE is doing,
3. whether SPORE needs input,
4. what button or reply matters next.

Everything else should be secondary.

## Visual Direction

The visual style should move away from a generic admin dashboard and toward a warm, modern mission-control surface.

### Principles

- warm light surface with depth and contrast,
- expressive hierarchy with strong hero treatment for the active mission,
- fewer flat lists and more intentional grouped cards,
- one accent language for action states,
- large spacing and breathable composition,
- obvious, elegant decision cards that feel important.

### State Language

- running and active states should feel energized,
- waiting-for-operator states should feel prominent and unmistakable,
- safe and approved states should feel calm and trustworthy,
- blocked and risky states should feel high-signal without becoming visually noisy.

### Constraint

Avoid a generic purple AI aesthetic. Favor the existing SPORE warm clay / ember / parchment direction and sharpen it into a clearer product identity.

## Interaction Model

The primary object in the UI is the mission, not the raw artifact.

The operator flow should read as:

- `I told SPORE what to do`
- `SPORE made a plan`
- `SPORE needs approval`
- `SPORE ran the work`
- `SPORE needs review`
- `SPORE is ready to promote`

Artifacts such as goal plans, proposals, validations, and integration branches still exist, but they should be shown as supporting evidence, not as the primary navigational model.

## Screen Structure

## 1. Mission-First Hero Header

The active mission needs a stronger top section containing:

- mission title,
- one-line plain-English status,
- phase label,
- runtime mode and safe-mode badges,
- a single primary CTA when a current decision exists.

This header should function like the "you are here" strip for the whole surface.

## 2. Main Conversation Column

The center column remains the primary reading path.

It should contain:

- a sticky `Current Decision` card when operator action is needed,
- the conversation timeline,
- the composer fixed to the bottom of the mission view.

The timeline should focus on explanation and confidence rather than raw log output.

## 3. Left Rail

The left rail should become quieter and more structured:

- `Start Mission` card,
- `Global Inbox`,
- recent or active mission list.

It must support multi-thread work, but should not visually compete with the active mission.

## 4. Right Rail

The right rail should become a contextual evidence panel.

It should answer:

- what artifact is this mission currently touching,
- why is SPORE asking me something,
- where do I go if I need deeper proof.

It should prefer summary-first cards with expansion or drilldown affordances.

## 5. Responsive Behavior

On narrow screens, the layout should collapse into:

- mission header,
- current decision,
- conversation,
- drawers or stacked sections for inbox and evidence.

The active mission must stay dominant in all layouts.

## Decision UX

Decision handling should become more explicit and easier to trust.

Each decision card should show:

- what SPORE wants to do,
- why this decision is needed,
- what happens next if approved,
- the most important primary action,
- smaller secondary actions.

Decision buttons should not have equal visual weight. There should be one clear default path and visually quieter alternatives.

## Plan Editing UX

Plan editing is now supported through chat, so the UI should help operators discover it.

When a goal-plan review gate is active, the chat surface should show inline quick-edit chips such as:

- `Keep only docs`
- `Drop web work`
- `Prioritize UI first`
- `Show plan options`

This reduces the need for the operator to guess command syntax.

## Global Inbox UX

The inbox should act as a triage rail across all missions.

### Requirements

- show all pending operator decisions across threads,
- make the thread title visible at a glance,
- keep each card compact and action-oriented,
- allow clicking the card to jump directly into the owning mission,
- allow acting directly from the inbox with the same action buttons.

### Priority

Inbox is globally useful, but still secondary to the active mission.

## Conversation Writing Style

The chat copy should be plain-language first.

Prefer:

- "I prepared a plan and need your approval before I start."
- "I finished the managed run and now need proposal review."
- "This mission is blocked because the proposal failed validation."

Avoid exposing only internal state labels without explanation.

## Progress Model

The UI should show a compact progress strip for each active mission, using human-readable stages:

- mission received,
- plan prepared,
- approved,
- work running,
- proposal ready,
- validated,
- ready to promote.

This gives first-time users a mental model without making them understand internal tables.

## Evidence Reveal

Evidence must be available but not forced.

Preferred reveal affordances:

- `Why?`
- `Show evidence`
- `Open full artifact`

The default experience should stay light and guided.

## Live Behavior

Live updates should feel calm and informative.

- show subtle activity states when SPORE is progressing,
- keep streaming updates scoped to the selected mission,
- avoid noisy scrolling or raw event spam,
- preserve the sense that the operator is watching a guided process rather than a terminal feed.

## Safety Communication

When the selected mission runs in real execution mode rather than stub mode, the mission header should clearly communicate:

- real runtime mode,
- mutation risk,
- whether safe mode is still active.

The operator should never forget when a mission can mutate the repository.

## Implementation Scope

This polish pass is still deliberately scoped.

Priority order:

1. stronger mission hero and plain-language status,
2. clearer current-decision UX,
3. progress strip with real SPORE states,
4. better global inbox presentation,
5. better evidence summaries,
6. responsive simplification for smaller screens.

This pass should not try to solve every future conversational UX problem at once.

## Backend vs Frontend Ownership

To preserve the thin-client rule, the browser should not invent the primary mission state model.

The orchestrator thread detail should author the following projections:

- `hero`: title, plain-language status line, current phase label, primary CTA hint,
- `progress`: ordered mission stages plus current stage and current state,
- `decisionGuidance`: what the decision means, what happens next, and suggested replies,
- `evidenceSummary`: compact summaries for the currently active goal plan, proposal, validation, and promotion context,
- `inboxSummary`: concise label for global inbox rows.

For the global inbox specifically, `GET /operator/actions?status=pending` should be enriched so each action row already carries:

- mission title,
- one-line mission objective,
- urgency or waiting-age label,
- one-line decision reason,
- direct action metadata.

The browser should render the inbox directly from that payload instead of joining thread metadata client-side.

The browser may still format and arrange these values, but it should not infer the main operator story from raw artifacts on its own.

### Backend

- keep current operator chat model,
- continue using durable thread and pending-action state,
- do not alter source-of-truth ownership away from goal plans, proposals, validation, and promotion artifacts,
- extend operator-thread detail with server-authored UX projections for hero, progress, decision guidance, and evidence summaries.

### Frontend

Focus implementation on:

- stronger layout hierarchy,
- mission hero header,
- better decision cards,
- clearer inbox presentation,
- richer quick actions for plan edits,
- better visual language and spacing,
- clearer evidence presentation.

## Real Progress Mapping

The progress strip must reflect actual SPORE states, not only a happy path.

Canonical visible stages for this polish pass:

- `Mission received`
- `Plan prepared`
- `Plan approval`
- `Managed work running`
- `Proposal review`
- `Proposal approval`
- `Validation`
- `Promotion`

Supporting exceptional states:

- `Held`
- `Rework`
- `Quarantined`
- `Validation failed`
- `Promotion blocked`
- `Completed`

When one of these exceptional states is active, the hero line and progress strip should say so explicitly rather than pretending the mission is still on the happy path.

## Decision Card Contract

Each decision card should render backend-authored guidance containing:

- `title`
- `why`
- `nextIfApproved`
- `riskNote` when relevant
- `primaryAction`
- `secondaryActions`
- `suggestedReplies`

Initial decision types that must be covered cleanly:

- goal-plan review,
- proposal review,
- proposal approval,
- proposal rework,
- quarantine release,
- promotion.

## Quick-Edit Chips

Quick-edit chips should be shown only when the pending action is `goal-plan-review`.

Initial supported chips:

- `Keep only docs`
- `Keep only web`
- `Drop 2`
- `Prioritize UI first`
- `Show plan options`

For this polish pass, these chips should be orchestrator-authored suggested replies attached to the pending action or decision-guidance payload. If the backend cannot produce a chip safely for the current state, the browser should show none rather than inventing one.

## Global Inbox Contract

The global inbox is a cross-thread triage view, but it must stay compact.

Each row should show:

- mission title,
- pending decision title,
- urgency/waiting badge,
- one-line reason,
- direct action buttons.

Clicking the row should focus the owning mission and scroll the current decision into view.

## Evidence Presentation

Evidence should be summary-first.

Initial visible cards:

- plan summary,
- proposal summary,
- validation summary,
- promotion summary,
- quarantine summary when active.

Each card can expose deeper drilldown links, but the default presentation should stay compact and readable.

## Responsive Rules

This pass should use concrete breakpoints rather than open-ended mobile ideas.

- `>= 1280px`: three-column mission-control layout
- `900px - 1279px`: two-column layout with context stacked below the conversation
- `< 900px`: single-column stack in this order:
  - mission hero
  - current decision
  - conversation
  - global inbox
  - evidence

The composer stays visible at the end of the conversation section. Avoid drawer-heavy behavior in this pass to keep implementation predictable.

## Safety And Settings Visibility

The mission hero should always show:

- runtime mode (`stub` or `real`),
- safe mode,
- auto validate status.

The full thread settings card remains available in the context column for deeper inspection.

## Success Criteria

The polish is successful if a first-time operator can open the page and answer these questions within a few seconds:

- What mission is active?
- What is SPORE doing now?
- Does it need me?
- What should I do next?

And if the page looks productized enough that it feels like a deliberate operator console rather than an internal admin tool.
