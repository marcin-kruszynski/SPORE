import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import EvidenceDetailPage from "../src/pages/EvidenceDetailPage.js";
import SelfBuildPage from "../src/pages/SelfBuildPage.js";
import { loadProposalBackedContext } from "../src/features/evidence/use-mission-evidence.js";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function installDomGlobals(pathname: string) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: `http://127.0.0.1:8788${pathname}`,
  });

  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Element = dom.window.Element;
  globalThis.Node = dom.window.Node;
  globalThis.SVGElement = dom.window.SVGElement;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.FocusEvent = dom.window.FocusEvent;
  globalThis.DocumentFragment = dom.window.DocumentFragment;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  Object.defineProperty(globalThis.window, "matchMedia", {
    writable: true,
    value: () => ({
      matches: false,
      media: "",
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }),
  });

  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserver as unknown as typeof globalThis.ResizeObserver;
  globalThis.window.HTMLElement.prototype.scrollIntoView = () => {};

  return () => {
    dom.window.close();
  };
}

function renderRoute(element: React.ReactElement, initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MemoryRouter, { initialEntries: [initialEntry] }, element),
    ),
  );
}

afterEach(() => {
  cleanup();
});

test("SelfBuildPage renders a real-backed dashboard with proposal, validation, workspace, and promotion drilldowns", async () => {
  const restoreDom = installDomGlobals("/self-build");

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({
        ok: true,
        detail: {
          overview: {
            urgentCount: 2,
            followUpCount: 3,
            generatedAt: "2026-03-12T10:15:00.000Z",
          },
          freshness: {
            lastRefresh: "2026-03-12T10:15:00.000Z",
          },
          counts: {
            workItems: 6,
            groups: 2,
            pendingDocSuggestions: 1,
            validationRequiredProposals: 1,
            proposalsBlockedForPromotion: 1,
            integrationBranches: 1,
            orphanedWorkspaces: 1,
          },
          waitingReviewProposals: [
            {
              id: "proposal-review-1",
              title: "Proposal waiting review",
              status: "ready_for_review",
              summary: "Operator review is required before validation can begin.",
            },
          ],
          validationRequiredProposals: [
            {
              id: "proposal-validate-1",
              title: "Docs polish proposal",
              status: "validation_required",
              summary: "Validation is required before promotion readiness can be computed.",
            },
          ],
          proposalsBlockedForPromotion: [
            {
              id: "proposal-promote-1",
              title: "Promotion blocked proposal",
              status: "promotion_blocked",
              summary: "Validation blockers are still active.",
            },
          ],
          recentWorkItemRuns: [
            {
              id: "run-1",
              itemTitle: "Docs verification",
              status: "completed",
              validationStatus: "passed",
              hasProposal: true,
              hasWorkspace: true,
              comparisonToPrevious: {
                summary: "Stable against the previous run.",
              },
            },
          ],
          workspaces: [
            {
              id: "workspace-1",
              branchName: "spore/docs/polish",
              status: "active",
              workItemId: "item-1",
              worktreePath: "/tmp/spore/docs-publish",
            },
          ],
          integrationBranches: [
            {
              name: "spore/integration/docs-polish",
              status: "blocked",
              targetBranch: "main",
              proposalArtifactId: "proposal-promote-1",
              diagnostics: {
                issues: [{ reason: "Regression report still failing." }],
              },
            },
          ],
          groups: [
            {
              id: "group-1",
              title: "Docs group",
              status: "running",
              readiness: {
                headlineState: "blocked",
                preRunSummary: {
                  label: "1 item is blocked on review.",
                },
                counts: {
                  ready: 1,
                  blocked: 1,
                  reviewNeeded: 1,
                },
              },
            },
          ],
          attentionSummary: {
            total: 4,
            byState: {
              blocked: 1,
              validation_required: 2,
            },
          },
          lifecycle: {
            blockedPromotions: 1,
            pendingValidations: 1,
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/dashboard")) {
      return jsonResponse({
        ok: true,
        detail: {
          attentionSummary: {
            total: 4,
          },
          queueSummary: {
            total: 5,
          },
          lifecycle: {
            blockedPromotions: 1,
            pendingValidations: 1,
            activeAutonomousRuns: 0,
            quarantinedWork: 0,
            protectedTierOverrides: 0,
            policyRecommendationQueue: 0,
          },
          recentWorkItemRuns: [
            {
              id: "run-1",
              itemTitle: "Docs verification",
              status: "completed",
              validationStatus: "passed",
              hasProposal: true,
              hasWorkspace: true,
            },
          ],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderRoute(React.createElement(SelfBuildPage), "/self-build");

  await view.findByText("Self-Build");
  await view.findByText("Proposal waiting review");
  await view.findByText("Docs verification");
  await view.findByText("spore/docs/polish");
  await view.findByText("spore/integration/docs-polish");

  assert.equal(
    view.getByRole("link", { name: /proposal waiting review/i }).getAttribute("href"),
    "/evidence/proposal/proposal-review-1",
  );
  assert.equal(
    view.getByRole("link", { name: /promotion blocked proposal/i }).getAttribute("href"),
    "/evidence/promotion/spore%2Fintegration%2Fdocs-polish?subject=branch",
  );
  assert.equal(
    view.getByRole("link", { name: /docs verification/i }).getAttribute("href"),
    "/evidence/validation/run-1?subject=run",
  );
  assert.equal(
    view.getByRole("link", { name: /spore\/docs\/polish/i }).getAttribute("href"),
    "/evidence/workspace/workspace-1?subject=workspace",
  );

  restoreDom();
});

test("EvidenceDetailPage loads validation evidence and related proposal, workspace, scenario, and regression context", async () => {
  const restoreDom = installDomGlobals("/evidence/validation/run-1?subject=run");
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/api/orchestrator/work-item-runs/run-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "run-1",
          status: "completed",
          validationStatus: "passed",
          comparisonToPrevious: {
            summary: "No regressions compared with the previous run.",
          },
          proposal: {
            id: "proposal-1",
            title: "Docs proposal",
            status: "validation_required",
          },
          workspace: {
            id: "workspace-1",
            branchName: "spore/docs/polish",
            status: "active",
          },
          validation: {
            status: "passed",
            summary: "proposal-ready-fast and integration-ready-core passed",
          },
          docSuggestions: [{ id: "doc-1", title: "Update roadmap note" }],
          suggestedActions: [{ action: "promote", reason: "Validation is green." }],
          relationSummary: {
            scenarioRunId: "scenario-1",
            regressionRunId: "regression-1",
          },
          links: {
            scenarioRun: "/scenario-runs/scenario-1",
            regressionRun: "/regression-runs/regression-1",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/work-item-runs/run-1/proposal")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "proposal-1",
          status: "validation_required",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1/review-package")) {
      return jsonResponse({
        ok: true,
        detail: {
          proposal: {
            id: "proposal-1",
            status: "validation_required",
          },
          readiness: {
            ready: false,
            blockers: [{ code: "validation_required" }],
          },
          promotion: {
            integrationBranch: "spore/integration/docs-polish",
            status: "blocked",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/work-item-runs/run-1/workspace")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "workspace-1",
          status: "active",
          branchName: "spore/docs/polish",
          worktreePath: "/tmp/spore/docs-publish",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/workspaces/workspace-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "workspace-1",
          status: "active",
          branchName: "spore/docs/polish",
          worktreePath: "/tmp/spore/docs-publish",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/scenario-runs/scenario-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          run: {
            id: "scenario-1",
            status: "passed",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/regression-runs/regression-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          run: {
            id: "regression-1",
            status: "passed",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/regression-runs/regression-1/report")) {
      return jsonResponse({
        ok: true,
        detail: {
          report: {
            summary: "All regressions passed.",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/workspaces/workspace-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "workspace-1",
          status: "active",
          branchName: "spore/docs/polish",
          worktreePath: "/tmp/spore/docs-publish",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/workspaces/workspace-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "workspace-1",
          status: "active",
          branchName: "spore/docs/polish",
          worktreePath: "/tmp/spore/docs-publish",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/integration-branches/spore%2Fintegration%2Fdocs-polish")) {
      return jsonResponse({
        ok: true,
        detail: {
          name: "spore/integration/docs-polish",
          status: "blocked",
          targetBranch: "main",
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderRoute(
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: "/evidence/:kind/:id",
        element: React.createElement(EvidenceDetailPage),
      }),
    ),
    "/evidence/validation/run-1?subject=run",
  );

  await view.findByRole("heading", { name: "Validation Evidence" });
  assert.ok(
    (await view.findAllByText("No regressions compared with the previous run.")).length >= 1,
  );
  await view.findByText("proposal-ready-fast and integration-ready-core passed");
  await view.findByText("All regressions passed.");
  await view.findByRole("link", { name: /docs proposal/i });
  await view.findByRole("link", { name: /spore\/docs\/polish/i });
  await view.findByRole("link", { name: /spore\/integration\/docs-polish/i });

  assert.ok(calls.some((url) => url.endsWith("/api/orchestrator/work-item-runs/run-1")));
  assert.ok(
    calls.some((url) =>
      url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1/review-package"),
    ),
  );
  assert.ok(
    calls.some((url) => url.endsWith("/api/orchestrator/regression-runs/regression-1/report")),
  );

  restoreDom();
});

test("EvidenceDetailPage recovers proposal readiness and promotion context for validation drilldowns when the run omits embedded proposal linkage", async () => {
  const restoreDom = installDomGlobals("/evidence/validation/run-2?subject=run");
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/api/orchestrator/work-item-runs/run-2")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "run-2",
          status: "completed",
          validationStatus: "passed",
          comparisonToPrevious: {
            summary: "Recovered proposal context from linked evidence.",
          },
          workspace: {
            id: "workspace-2",
            branchName: "spore/docs/recovered",
            status: "active",
          },
          validation: {
            status: "passed",
            summary: "proposal-ready-fast passed",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/work-item-runs/run-2/proposal")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "proposal-2",
          title: "Recovered proposal",
          status: "validation_required",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/work-item-runs/run-2/workspace")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "workspace-2",
          status: "active",
          branchName: "spore/docs/recovered",
          worktreePath: "/tmp/spore/docs-recovered",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/proposal-artifacts/proposal-2/review-package")) {
      return jsonResponse({
        ok: true,
        detail: {
          proposal: {
            id: "proposal-2",
            title: "Recovered proposal",
            status: "validation_required",
          },
          readiness: {
            ready: false,
            blockers: [{ code: "validation_required" }],
          },
          promotion: {
            integrationBranch: "spore/integration/recovered",
            status: "blocked",
          },
          trace: {
            promotion: {
              summary: "Validation is waiting on proposal readiness.",
            },
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/integration-branches/spore%2Fintegration%2Frecovered")) {
      return jsonResponse({
        ok: true,
        detail: {
          name: "spore/integration/recovered",
          status: "blocked",
          targetBranch: "main",
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderRoute(
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: "/evidence/:kind/:id",
        element: React.createElement(EvidenceDetailPage),
      }),
    ),
    "/evidence/validation/run-2?subject=run",
  );

  await view.findByRole("heading", { name: "Validation Evidence" });
  await view.findByText("Validation is waiting on proposal readiness.");
  await view.findByRole("link", { name: /recovered proposal/i });
  await view.findByRole("link", { name: /spore\/integration\/recovered/i });

  assert.ok(
    calls.some((url) =>
      url.endsWith("/api/orchestrator/proposal-artifacts/proposal-2/review-package"),
    ),
  );
  assert.ok(
    calls.some((url) =>
      url.endsWith("/api/orchestrator/integration-branches/spore%2Fintegration%2Frecovered"),
    ),
  );

  restoreDom();
});

test("EvidenceDetailPage keeps validation and workspace context on proposal drilldowns", async () => {
  const restoreDom = installDomGlobals("/evidence/proposal/proposal-1");
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "proposal-1",
          title: "Docs proposal",
          status: "validation_required",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1/review-package")) {
      return jsonResponse({
        ok: true,
        detail: {
          proposal: {
            id: "proposal-1",
            title: "Docs proposal",
            status: "validation_required",
          },
          readiness: {
            ready: false,
            blockers: [{ code: "validation_required" }],
          },
          promotion: {
            integrationBranch: "spore/integration/docs-polish",
            status: "blocked",
          },
          workItemRun: {
            id: "run-1",
          },
          workspace: {
            id: "workspace-1",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/work-item-runs/run-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "run-1",
          status: "completed",
          validationStatus: "passed",
          comparisonToPrevious: {
            summary: "No regressions compared with the previous run.",
          },
          validation: {
            status: "passed",
            summary: "proposal-ready-fast passed",
          },
          workspace: {
            id: "workspace-1",
            branchName: "spore/docs/polish",
            status: "active",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/work-item-runs/run-1/workspace")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "workspace-1",
          status: "active",
          branchName: "spore/docs/polish",
          worktreePath: "/tmp/spore/docs-publish",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/workspaces/workspace-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "workspace-1",
          status: "active",
          branchName: "spore/docs/polish",
          worktreePath: "/tmp/spore/docs-publish",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/integration-branches/spore%2Fintegration%2Fdocs-polish")) {
      return jsonResponse({
        ok: true,
        detail: {
          name: "spore/integration/docs-polish",
          status: "blocked",
          targetBranch: "main",
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderRoute(
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: "/evidence/:kind/:id",
        element: React.createElement(EvidenceDetailPage),
      }),
    ),
    "/evidence/proposal/proposal-1",
  );

  await view.findByRole("heading", { name: "Proposal Evidence" });
  await view.findByText("proposal-ready-fast passed");
  await view.findByText("/tmp/spore/docs-publish");
  await view.findByRole("link", { name: /spore\/docs\/polish/i });
  await view.findByRole("link", { name: /spore\/integration\/docs-polish/i });

  assert.ok(calls.some((url) => url.endsWith("/api/orchestrator/work-item-runs/run-1")));
  assert.ok(calls.some((url) => url.endsWith("/api/orchestrator/workspaces/workspace-1")));

  restoreDom();
});

test("EvidenceDetailPage keeps proposal and promotion context on workspace drilldowns", async () => {
  const restoreDom = installDomGlobals("/evidence/workspace/workspace-1?subject=workspace");
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/api/orchestrator/workspaces/workspace-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "workspace-1",
          status: "active",
          branchName: "spore/docs/polish",
          worktreePath: "/tmp/spore/docs-publish",
          workItemRunId: "run-1",
          proposalArtifactId: "proposal-1",
          trace: {
            allocation: {
              decision: "created",
              summary: "Created a safe-mode workspace for the run.",
              reasons: ["safe mode"],
            },
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/work-item-runs/run-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "run-1",
          status: "completed",
          validationStatus: "passed",
          proposal: {
            id: "proposal-1",
            title: "Docs proposal",
            status: "validation_required",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "proposal-1",
          title: "Docs proposal",
          status: "validation_required",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1/review-package")) {
      return jsonResponse({
        ok: true,
        detail: {
          proposal: {
            id: "proposal-1",
            title: "Docs proposal",
            status: "validation_required",
          },
          readiness: {
            ready: false,
            blockers: [{ code: "validation_required" }],
          },
          promotion: {
            integrationBranch: "spore/integration/docs-polish",
            status: "blocked",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/integration-branches/spore%2Fintegration%2Fdocs-polish")) {
      return jsonResponse({
        ok: true,
        detail: {
          name: "spore/integration/docs-polish",
          status: "blocked",
          targetBranch: "main",
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderRoute(
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: "/evidence/:kind/:id",
        element: React.createElement(EvidenceDetailPage),
      }),
    ),
    "/evidence/workspace/workspace-1?subject=workspace",
  );

  await view.findByRole("heading", { name: "Workspace Evidence" });
  await view.findByText("Created a safe-mode workspace for the run.");
  await view.findByRole("link", { name: /docs proposal/i });
  await view.findByRole("link", { name: /spore\/integration\/docs-polish/i });

  assert.ok(calls.some((url) => url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1/review-package")));
  assert.ok(calls.some((url) => url.endsWith("/api/orchestrator/integration-branches/spore%2Fintegration%2Fdocs-polish")));

  restoreDom();
});

test("EvidenceDetailPage requires an explicit branch subject for promotion drilldowns", async () => {
  const restoreDom = installDomGlobals("/evidence/promotion/spore%2Fintegration%2Fdocs-polish");
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    throw new Error("promotion route should not fetch without explicit subject");
  }) as typeof fetch;

  const view = renderRoute(
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: "/evidence/:kind/:id",
        element: React.createElement(EvidenceDetailPage),
      }),
    ),
    "/evidence/promotion/spore%2Fintegration%2Fdocs-polish",
  );

  await view.findByText("Evidence target is invalid");
  assert.equal(calls.length, 0);

  restoreDom();
});

test("EvidenceDetailPage loads explicit promotion branch drilldowns with linked proposal and workspace context", async () => {
  const restoreDom = installDomGlobals(
    "/evidence/promotion/spore%2Fintegration%2Fdocs-polish?subject=branch",
  );
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/api/orchestrator/integration-branches/spore%2Fintegration%2Fdocs-polish")) {
      return jsonResponse({
        ok: true,
        detail: {
          name: "spore/integration/docs-polish",
          status: "blocked",
          targetBranch: "main",
          proposalArtifactId: "proposal-1",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "proposal-1",
          title: "Docs proposal",
          status: "validation_required",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1/review-package")) {
      return jsonResponse({
        ok: true,
        detail: {
          proposal: {
            id: "proposal-1",
            title: "Docs proposal",
            status: "validation_required",
          },
          readiness: {
            ready: false,
            blockers: [{ code: "validation_required" }],
          },
          promotion: {
            integrationBranch: "spore/integration/docs-polish",
            status: "blocked",
            targetBranch: "main",
          },
          workItemRun: {
            id: "run-1",
          },
          workspace: {
            id: "workspace-1",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/work-item-runs/run-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "run-1",
          status: "completed",
          validationStatus: "passed",
          comparisonToPrevious: {
            summary: "Promotion remains blocked until readiness is green.",
          },
          validation: {
            status: "passed",
            summary: "integration-ready-core passed",
          },
          workspace: {
            id: "workspace-1",
            branchName: "spore/docs/polish",
            status: "active",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/workspaces/workspace-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "workspace-1",
          status: "active",
          branchName: "spore/docs/polish",
          worktreePath: "/tmp/spore/docs-publish",
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderRoute(
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: "/evidence/:kind/:id",
        element: React.createElement(EvidenceDetailPage),
      }),
    ),
    "/evidence/promotion/spore%2Fintegration%2Fdocs-polish?subject=branch",
  );

  await view.findByRole("heading", { name: "Promotion Evidence" });
  await view.findByText("integration-ready-core passed");
  await view.findByText("/tmp/spore/docs-publish");
  await view.findByRole("link", { name: /docs proposal/i });
  await view.findByRole("link", { name: /spore\/docs\/polish/i });

  assert.ok(
    calls.some((url) =>
      url.endsWith("/api/orchestrator/integration-branches/spore%2Fintegration%2Fdocs-polish"),
    ),
  );
  assert.ok(calls.some((url) => url.endsWith("/api/orchestrator/workspaces/workspace-1")));

  restoreDom();
});

test("EvidenceDetailPage keeps proposal drilldowns usable when optional workspace and branch context return 404", async () => {
  const restoreDom = installDomGlobals("/evidence/proposal/proposal-1");
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "proposal-1",
          title: "Docs proposal",
          status: "validation_required",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1/review-package")) {
      return jsonResponse({
        ok: true,
        detail: {
          proposal: {
            id: "proposal-1",
            title: "Docs proposal",
            status: "validation_required",
          },
          readiness: {
            ready: false,
            blockers: [{ code: "validation_required" }],
          },
          promotion: {
            integrationBranch: "spore/integration/docs-polish",
            status: "blocked",
          },
          workItemRun: {
            id: "run-1",
          },
          workspace: {
            id: "workspace-1",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/work-item-runs/run-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "run-1",
          status: "completed",
          validationStatus: "passed",
          validation: {
            status: "passed",
            summary: "proposal-ready-fast passed",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/workspaces/workspace-1")) {
      return jsonResponse({ ok: false, error: "not_found" }, { status: 404 });
    }

    if (url.endsWith("/api/orchestrator/integration-branches/spore%2Fintegration%2Fdocs-polish")) {
      return jsonResponse({ ok: false, error: "not_found" }, { status: 404 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderRoute(
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: "/evidence/:kind/:id",
        element: React.createElement(EvidenceDetailPage),
      }),
    ),
    "/evidence/proposal/proposal-1",
  );

  await view.findByRole("heading", { name: "Proposal Evidence" });
  await view.findByText("proposal-ready-fast passed");
  assert.equal(view.queryByText("Evidence detail is unavailable"), null);
  assert.ok(calls.some((url) => url.endsWith("/api/orchestrator/workspaces/workspace-1")));
  assert.ok(
    calls.some((url) =>
      url.endsWith("/api/orchestrator/integration-branches/spore%2Fintegration%2Fdocs-polish"),
    ),
  );

  restoreDom();
});

test("loadProposalBackedContext backfills workspace from a linked run discovered via the proposal review package", async () => {
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "proposal-1",
          title: "Docs proposal",
          status: "validation_required",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1/review-package")) {
      return jsonResponse({
        ok: true,
        detail: {
          proposal: {
            id: "proposal-1",
            title: "Docs proposal",
            status: "validation_required",
          },
          workItemRun: {
            id: "run-1",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/work-item-runs/run-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "run-1",
          status: "completed",
          workspace: {
            id: "workspace-1",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/workspaces/workspace-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "workspace-1",
          status: "active",
          branchName: "spore/docs/polish",
          worktreePath: "/tmp/spore/docs-publish",
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const context = await loadProposalBackedContext({
    proposalId: "proposal-1",
  });

  assert.equal(context.run?.id, "run-1");
  assert.equal(context.workspace?.id, "workspace-1");
  assert.ok(calls.some((url) => url.endsWith("/api/orchestrator/work-item-runs/run-1")));
  assert.ok(calls.some((url) => url.endsWith("/api/orchestrator/workspaces/workspace-1")));
});

test("loadProposalBackedContext backfills proposal and readiness from workspace context discovered after a run fetch", async () => {
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/api/orchestrator/workspaces/workspace-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "workspace-1",
          status: "active",
          branchName: "spore/docs/polish",
          proposalArtifactId: "proposal-1",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          id: "proposal-1",
          title: "Docs proposal",
          status: "validation_required",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1/review-package")) {
      return jsonResponse({
        ok: true,
        detail: {
          proposal: {
            id: "proposal-1",
            title: "Docs proposal",
            status: "validation_required",
          },
          readiness: {
            ready: false,
            blockers: [{ code: "validation_required" }],
          },
          promotion: {
            integrationBranch: "spore/integration/docs-polish",
            status: "blocked",
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/integration-branches/spore%2Fintegration%2Fdocs-polish")) {
      return jsonResponse({
        ok: true,
        detail: {
          name: "spore/integration/docs-polish",
          status: "blocked",
          targetBranch: "main",
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const context = await loadProposalBackedContext({
    run: {
      id: "run-1",
      status: "completed",
      workspace: {
        id: "workspace-1",
      },
    },
  });

  assert.equal(context.workspace?.proposalArtifactId, "proposal-1");
  assert.equal(context.proposal?.id, "proposal-1");
  assert.equal(context.proposalReviewPackage?.promotion?.integrationBranch, "spore/integration/docs-polish");
  assert.ok(calls.some((url) => url.endsWith("/api/orchestrator/workspaces/workspace-1")));
  assert.ok(
    calls.some((url) => url.endsWith("/api/orchestrator/proposal-artifacts/proposal-1/review-package")),
  );
});
