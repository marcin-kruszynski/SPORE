import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import {
  cleanupCockpitTestResources,
  installDomGlobals,
  jsonResponse,
  renderCockpit,
} from "./agent-cockpit-test-utils.js";

afterEach(() => {
  cleanup();
  cleanupCockpitTestResources();
});

test("AgentCockpitPage renders active lanes, attention, recent artifacts, and click-through links from real-derived data", async () => {
  const restoreDom = installDomGlobals("/cockpit");

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({
        ok: true,
        detail: [
          {
            id: "thread-1",
            title: "Mission Alpha",
            status: "active",
            updatedAt: "2026-03-12T10:05:00.000Z",
            summary: {
              objective: "Ship the cockpit home.",
              lastMessageExcerpt: "Validation is running.",
            },
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({ ok: true, detail: [] });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "thread-1",
          title: "Mission Alpha",
          status: "active",
          updatedAt: "2026-03-12T10:05:00.000Z",
          summary: {
            objective: "Ship the cockpit home.",
            lastMessageExcerpt: "Validation is running.",
          },
          progress: {
            currentStage: "validation_running",
            currentState: "running",
          },
          metadata: {
            execution: {
              executionId: "exec-1",
            },
          },
          messages: [
            {
              id: "message-1",
              role: "assistant",
              kind: "message",
              content: "Proposal proposal-1 needs validation. I am running the configured validation flow now.",
              createdAt: "2026-03-12T10:05:00.000Z",
              payload: {
                artifacts: [
                  {
                    itemType: "proposal",
                    itemId: "proposal-1",
                    title: "Fallback proposal title",
                    status: "validation_required",
                  },
                ],
              },
            },
          ],
          context: {
            linkedArtifacts: [
              {
                itemType: "proposal",
                itemId: "proposal-1",
                title: "Fallback proposal title",
                status: "validation_required",
              },
            ],
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/executions/exec-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          execution: {
            id: "exec-1",
            state: "running",
            objective: "Ship the cockpit home.",
            projectRole: "implementer",
          },
          sessions: [
            {
              sessionId: "session-1",
              session: {
                id: "session-1",
                role: "implementer",
                state: "active",
                updatedAt: "2026-03-12T10:05:00.000Z",
              },
            },
          ],
        },
      });
    }

    if (url.endsWith("/api/sessions/session-1/live")) {
      return jsonResponse({
        ok: true,
        session: {
          id: "session-1",
          role: "implementer",
          state: "active",
          updatedAt: "2026-03-12T10:05:00.000Z",
        },
        diagnostics: {
          status: "running",
          lastEventAt: "2026-03-12T10:05:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({
        ok: true,
        detail: {
          waitingApprovalProposals: [],
          recentWorkItemRuns: [
            {
              id: "run-1",
              itemTitle: "Frontend feature delivery",
              status: "blocked",
              validationStatus: "running",
              hasProposal: true,
              hasWorkspace: true,
            },
          ],
          workspaces: [],
          integrationBranches: [],
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/dashboard")) {
      return jsonResponse({
        ok: true,
        detail: {
          recentWorkItemRuns: [
            {
              id: "run-1",
              itemTitle: "Frontend feature delivery",
              status: "blocked",
              validationStatus: "running",
              hasProposal: true,
              hasWorkspace: true,
            },
          ],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderCockpit();

  await view.findByRole("heading", { name: "Agent Cockpit" });
  await view.findByText("Implementer");
  await view.findByText("Proposal proposal-1 is validating");
  await view.findByText("Frontend feature delivery");

  const openLaneLink = view.getByRole("link", { name: /open implementer lane/i });
  assert.equal(openLaneLink.getAttribute("href"), "/cockpit/agents/session%3Asession-1");

  const openSessionLink = view.getByRole("link", { name: /open session/i });
  assert.equal(openSessionLink.getAttribute("href"), "/api/sessions/session-1/live");

  restoreDom();
});

test("AgentCockpitPage shows explicit empty and degraded states while preserving last-known lanes", async () => {
  const restoreDom = installDomGlobals("/cockpit");

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({
        ok: true,
        detail: [
          {
            id: "thread-1",
            title: "Mission Alpha",
            status: "active",
            updatedAt: "2026-03-12T10:05:00.000Z",
            summary: {
              objective: "Ship the cockpit home.",
              lastMessageExcerpt: "Validation is running.",
            },
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({ ok: false, error: "actions_unavailable" }, { status: 503 });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "thread-1",
          title: "Mission Alpha",
          status: "active",
          updatedAt: "2026-03-12T10:05:00.000Z",
          summary: {
            objective: "Ship the cockpit home.",
            lastMessageExcerpt: "Validation is running.",
          },
          progress: {
            currentStage: "validation_running",
            currentState: "running",
          },
          metadata: {
            execution: {
              executionId: "exec-1",
            },
          },
          messages: [],
          context: {
            linkedArtifacts: [],
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/executions/exec-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          execution: {
            id: "exec-1",
            state: "running",
            objective: "Ship the cockpit home.",
            projectRole: "implementer",
          },
          sessions: [
            {
              sessionId: "session-1",
              session: {
                id: "session-1",
                role: "implementer",
                state: "active",
                updatedAt: "2026-03-12T10:05:00.000Z",
              },
            },
          ],
        },
      });
    }

    if (url.endsWith("/api/sessions/session-1/live")) {
      return jsonResponse({
        ok: true,
        session: {
          id: "session-1",
          role: "implementer",
          state: "active",
          updatedAt: "2026-03-12T10:05:00.000Z",
        },
        diagnostics: {
          status: "running",
          lastEventAt: "2026-03-12T10:05:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({ ok: false, error: "summary_unavailable" }, { status: 503 });
    }

    if (url.endsWith("/api/orchestrator/self-build/dashboard")) {
      return jsonResponse({ ok: false, error: "dashboard_unavailable" }, { status: 503 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderCockpit();

  await waitFor(() => {
    assert.match(view.container.textContent ?? "", /cockpit is in degraded mode/i);
  });

  await view.findByText("Implementer");

  cleanup();
  cleanupCockpitTestResources();
  restoreDom();

  const emptyRestoreDom = installDomGlobals("/cockpit");

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({ ok: true, detail: [] });
    }
    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({ ok: true, detail: [] });
    }
    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({ ok: true, detail: { waitingApprovalProposals: [], recentWorkItemRuns: [], workspaces: [], integrationBranches: [] } });
    }
    if (url.endsWith("/api/orchestrator/self-build/dashboard")) {
      return jsonResponse({ ok: true, detail: { recentWorkItemRuns: [] } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const emptyView = renderCockpit();
  await emptyView.findByText(/no active agents yet/i);
  assert.equal(emptyView.getByRole("link", { name: /open chat/i }).getAttribute("href"), "/chat");
  assert.equal(emptyView.getByRole("link", { name: /open mission map/i }).getAttribute("href"), "/mission-map");

  emptyRestoreDom();
});

test("AgentCockpitPage focuses the current mission family and hides older history until expanded", async () => {
  const restoreDom = installDomGlobals("/cockpit");

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({
        ok: true,
        detail: [
          {
            id: "thread-new",
            title: "Current mission",
            status: "running",
            updatedAt: "2026-03-13T12:00:00.000Z",
            summary: {
              objective: "Current mission objective",
              lastMessageExcerpt: "Current work is running.",
            },
          },
          {
            id: "thread-old",
            title: "Historical mission",
            status: "completed",
            updatedAt: "2026-03-13T10:00:00.000Z",
            summary: {
              objective: "Historical mission objective",
              lastMessageExcerpt: "Historical work finished.",
            },
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({
        ok: true,
        detail: [
          {
            id: "action-new",
            threadId: "thread-new",
            targetType: "proposal",
            targetId: "proposal-new",
            kind: "approval",
            status: "pending",
            summary: {
              title: "Approve current proposal",
              reason: "Current mission needs approval.",
            },
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-new")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "thread-new",
          title: "Current mission",
          status: "running",
          updatedAt: "2026-03-13T12:00:00.000Z",
          summary: {
            objective: "Current mission objective",
            lastMessageExcerpt: "Current work is running.",
          },
          progress: {
            currentStage: "implementation_running",
            currentState: "running",
          },
          metadata: {
            execution: {
              executionId: "exec-new",
            },
          },
          messages: [],
          context: {
            linkedArtifacts: [],
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-old")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "thread-old",
          title: "Historical mission",
          status: "completed",
          updatedAt: "2026-03-13T10:00:00.000Z",
          summary: {
            objective: "Historical mission objective",
            lastMessageExcerpt: "Historical work finished.",
          },
          progress: {
            currentStage: "promotion_launched",
            currentState: "completed",
          },
          metadata: {
            execution: {
              executionId: "exec-old",
            },
          },
          messages: [],
          context: {
            linkedArtifacts: [],
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/executions/exec-new")) {
      return jsonResponse({
        ok: true,
        detail: {
          execution: {
            id: "exec-new",
            state: "running",
            workflowId: "feature-delivery",
            projectRole: "builder",
          },
          steps: [
            {
              sessionId: "current-builder",
              role: "builder",
              waveName: "wave-4",
              state: "running",
            },
          ],
          sessions: [
            {
              sessionId: "current-builder",
              session: {
                id: "current-builder",
                role: "builder",
                state: "active",
                updatedAt: "2026-03-13T12:00:00.000Z",
              },
            },
          ],
        },
      });
    }

    if (url.endsWith("/api/orchestrator/executions/exec-old")) {
      return jsonResponse({
        ok: true,
        detail: {
          execution: {
            id: "exec-old",
            state: "completed",
            workflowId: "feature-delivery",
            projectRole: "builder",
          },
          steps: [
            {
              sessionId: "old-builder",
              role: "builder",
              waveName: "wave-4",
              state: "completed",
            },
          ],
          sessions: [
            {
              sessionId: "old-builder",
              session: {
                id: "old-builder",
                role: "builder",
                state: "completed",
                updatedAt: "2026-03-13T10:00:00.000Z",
              },
            },
          ],
        },
      });
    }

    if (url.endsWith("/api/sessions/current-builder/live")) {
      return jsonResponse({
        ok: true,
        session: {
          id: "current-builder",
          role: "builder",
          state: "active",
          updatedAt: "2026-03-13T12:00:00.000Z",
        },
        diagnostics: {
          status: "running",
          lastEventAt: "2026-03-13T12:00:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/sessions/old-builder/live")) {
      return jsonResponse({
        ok: true,
        session: {
          id: "old-builder",
          role: "builder",
          state: "completed",
          updatedAt: "2026-03-13T10:00:00.000Z",
        },
        diagnostics: {
          status: "completed",
          lastEventAt: "2026-03-13T10:00:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({ ok: true, detail: { waitingApprovalProposals: [], recentWorkItemRuns: [], workspaces: [], integrationBranches: [] } });
    }

    if (url.endsWith("/api/orchestrator/self-build/dashboard")) {
      return jsonResponse({ ok: true, detail: { recentWorkItemRuns: [] } });
    }

    if (url.endsWith("/api/orchestrator/workspaces")) {
      return jsonResponse({ ok: true, detail: [] });
    }

    if (url.endsWith("/api/sessions")) {
      return jsonResponse({
        ok: true,
        sessions: [
          {
            id: "current-builder",
            role: "builder",
            state: "active",
            workflowId: "feature-delivery",
            updatedAt: "2026-03-13T12:00:00.000Z",
          },
          {
            id: "old-builder",
            role: "builder",
            state: "completed",
            workflowId: "feature-delivery",
            updatedAt: "2026-03-13T10:00:00.000Z",
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderCockpit();

  await view.findByText("Current work is running.");
  await view.findByRole("button", { name: /show history/i });
  assert.equal(view.queryByText("Historical work finished."), null);

  const showHistory = view.getByRole("button", { name: /show history/i });
  fireEvent.click(showHistory);

  await view.findByText("Historical work finished.");

  restoreDom();
});
