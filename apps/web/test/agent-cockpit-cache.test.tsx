import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { act, cleanup } from "@testing-library/react";

import {
  createTestQueryClient,
  cleanupCockpitTestResources,
  installDomGlobals,
  jsonResponse,
  renderCockpit,
} from "./agent-cockpit-test-utils.js";

afterEach(() => {
  cleanup();
  cleanupCockpitTestResources();
});

test("AgentCockpitPage does not reuse lane-detail bootstrap cache as the full cockpit home model", async () => {
  const restoreDom = installDomGlobals("/cockpit/agents/session%3Asession-1");
  const requests: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);

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
          {
            id: "thread-2",
            title: "Mission Beta",
            status: "completed",
            updatedAt: "2026-03-12T09:05:00.000Z",
            summary: {
              objective: "Historical mission.",
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
            id: "action-1",
            threadId: "thread-1",
            targetType: "proposal",
            targetId: "proposal-1",
            kind: "approval",
            status: "pending",
            summary: {
              title: "Approve proposal-1",
              reason: "Operator approval is required.",
            },
          },
        ],
      });
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

    if (url.endsWith("/api/orchestrator/operator/threads/thread-2")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "thread-2",
          title: "Mission Beta",
          status: "completed",
          updatedAt: "2026-03-12T09:05:00.000Z",
          summary: {
            objective: "Historical mission.",
            lastMessageExcerpt: "Historical work finished.",
          },
          progress: {
            currentStage: "promotion_launched",
            currentState: "completed",
          },
          metadata: {
            execution: {
              executionId: "exec-2",
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

    if (url.endsWith("/api/orchestrator/executions/exec-2")) {
      return jsonResponse({
        ok: true,
        detail: {
          execution: {
            id: "exec-2",
            state: "completed",
            objective: "Historical mission.",
            projectRole: "implementer",
          },
          sessions: [
            {
              sessionId: "session-2",
              session: {
                id: "session-2",
                role: "implementer",
                state: "completed",
                updatedAt: "2026-03-12T09:05:00.000Z",
              },
            },
          ],
        },
      });
    }

    if (url.endsWith("/api/orchestrator/executions/exec-1/tree")) {
      return jsonResponse({
        ok: true,
        tree: {
          selectedExecutionId: "exec-1",
          rootExecutionId: "exec-1",
          root: {
            execution: {
              id: "exec-1",
              state: "running",
            },
            children: [],
          },
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

    if (url.endsWith("/api/sessions/session-2/live")) {
      return jsonResponse({
        ok: true,
        session: {
          id: "session-2",
          role: "implementer",
          state: "completed",
          updatedAt: "2026-03-12T09:05:00.000Z",
        },
        diagnostics: {
          status: "completed",
          lastEventAt: "2026-03-12T09:05:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/workspaces")) {
      return jsonResponse({ ok: true, detail: [] });
    }

    if (url.endsWith("/api/sessions")) {
      return jsonResponse({
        ok: true,
        sessions: [
          {
            id: "session-1",
            role: "implementer",
            state: "active",
            workflowId: "feature-delivery",
            updatedAt: "2026-03-12T10:05:00.000Z",
          },
          {
            id: "session-2",
            role: "implementer",
            state: "completed",
            workflowId: "feature-delivery",
            updatedAt: "2026-03-12T09:05:00.000Z",
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({
        ok: true,
        detail: {
          waitingApprovalProposals: [
            {
              id: "proposal-1",
              title: "Backend-authored proposal label",
              status: "ready_for_review",
            },
          ],
          recentWorkItemRuns: [],
          workspaces: [],
          integrationBranches: [],
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/dashboard")) {
      return jsonResponse({
        ok: true,
        detail: {
          recentWorkItemRuns: [],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const queryClient = createTestQueryClient();
  const view = renderCockpit("/cockpit/agents/session%3Asession-1", queryClient);

  await view.findByRole("heading", { name: "Implementer" });
  assert.ok(
    !requests.some((request) => request.endsWith("/api/orchestrator/self-build/summary")),
  );

  await act(async () => {
    await view.router.navigate("/cockpit");
  });

  await view.findByRole("heading", { name: "Agent Cockpit" });
  await view.findByText("Implementer");
  assert.ok(!requests.some((request) => request.endsWith("/api/orchestrator/self-build/summary")));
  assert.ok(requests.some((request) => request.endsWith("/api/orchestrator/operator/actions")));

  restoreDom();
});

test("AgentCockpitPage shows current-family lanes before slow self-build summaries hydrate", async () => {
  const restoreDom = installDomGlobals("/cockpit");
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);

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

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderCockpit();

  await view.findByText("Implementer", {}, { timeout: 300 });
  assert.ok(!requests.some((request) => request.endsWith("/api/orchestrator/self-build/summary")));
  assert.ok(!requests.some((request) => request.endsWith("/api/orchestrator/self-build/dashboard")));

  restoreDom();
});
