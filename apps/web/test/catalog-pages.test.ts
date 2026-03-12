import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import React from "react";
import { cleanup, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { Space } from "../src/data/mock-data.js";
import App from "../src/App.js";
import {
  catalogAgents,
  catalogSkills,
  catalogSpaces,
  catalogTeams,
  getCatalogAgent,
  getAgentsForSkill,
  getProjectsForSpace,
  getSettingsPreviewSections,
} from "../src/mock/catalog.js";
import AgentDetailPage from "../src/pages/AgentDetailPage.js";
import SettingsPage from "../src/pages/SettingsPage.js";
import SpacesPage from "../src/pages/SpacesPage.js";
import SpaceDetailPage from "../src/pages/SpaceDetailPage.js";
import TeamDetailPage from "../src/pages/TeamDetailPage.js";

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
  return render(
    React.createElement(MemoryRouter, { initialEntries: [initialEntry] }, element),
  );
}

afterEach(() => {
  cleanup();
});

test("SpacesPage is an explicit mock-backed preview without create affordances", async () => {
  const restoreDom = installDomGlobals("/spaces");
  try {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("catalog mock pages should not fetch");
    }) as typeof fetch;

    const view = renderRoute(React.createElement(SpacesPage), "/spaces");

    await view.findByText("Spaces");
    assert.equal(fetchCalls, 0);
    assert.equal(view.queryByRole("button", { name: /create space/i }), null);
    assert.ok(document.querySelector('[data-source="mock"]'));
    await view.findByText(/unsupported create and edit actions are intentionally disabled/i);
  } finally {
    restoreDom();
  }
});

test("AgentDetailPage keeps skills and tools visible without broken detail links", async () => {
  const restoreDom = installDomGlobals("/agents/ag-1");
  try {
    const view = renderRoute(
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: "/agents/:id",
          element: React.createElement(AgentDetailPage),
        }),
      ),
      "/agents/ag-1",
    );

    await view.findByText(/agent detail is intentionally mock-backed/i);
    await view.findByText("Code Generation");
    await view.findByText("GitHub API");
    assert.equal(view.queryByRole("link", { name: /code generation/i }), null);
    assert.equal(view.queryByRole("link", { name: /github api/i }), null);
  } finally {
    restoreDom();
  }
});

test("SettingsPage is a read-only mock preview with unsupported write actions removed", async () => {
  const restoreDom = installDomGlobals("/settings");
  try {
    const view = renderRoute(React.createElement(SettingsPage), "/settings");

    await view.findByText("Settings");
    await view.findByText(/preview only/i);
    assert.equal(view.queryByRole("button", { name: /save changes/i }), null);
    assert.equal(view.queryByRole("button", { name: /reset to defaults/i }), null);
    assert.ok(document.querySelector('[data-source="mock"]'));
  } finally {
    restoreDom();
  }
});

test("Missing mock entity detail routes render NotFound", async () => {
  const restoreDom = installDomGlobals("/spaces/not-a-space");
  try {
    const view = renderRoute(
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: "/spaces/:id",
          element: React.createElement(SpaceDetailPage),
        }),
      ),
      "/spaces/not-a-space",
    );

    await view.findByText(/page not found/i);
  } finally {
    restoreDom();
  }
});

test("SpaceDetailPage only links project cards to live-backed project routes", async () => {
  const restoreDom = installDomGlobals("/spaces/sp-1");
  try {
    const view = renderRoute(
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: "/spaces/:id",
          element: React.createElement(SpaceDetailPage),
        }),
      ),
      "/spaces/sp-1",
    );

    await view.findByText(/linked seeded projects open the live-backed project route only when a derived match exists/i);
    assert.equal(view.queryByRole("link", { name: /spore-orchestrator/i }), null);
    assert.equal(view.queryByRole("link", { name: /spore-api-gateway/i }), null);
    assert.equal(view.queryByRole("link", { name: /spore-docs/i }), null);
    await view.findByText(/spore-orchestrator/i);
    await view.findByText(/spore-api-gateway/i);
    await view.findByText(/spore-docs/i);
  } finally {
    restoreDom();
  }
});

test("TeamDetailPage avoids broken project routes when no live-backed project match exists", async () => {
  const restoreDom = installDomGlobals("/teams/tm-3");
  try {
    const view = renderRoute(
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: "/teams/:id",
          element: React.createElement(TeamDetailPage),
        }),
      ),
      "/teams/tm-3",
    );

    await view.findByText(/linked projects without a current derived route stay read-only/i);
    assert.equal(view.queryByRole("link", { name: /spore-orchestrator/i }), null);
    assert.equal(view.queryByRole("link", { name: /customer-dashboard/i }), null);
    await view.findByText(/spore-orchestrator/i);
    await view.findByText(/customer-dashboard/i);
  } finally {
    restoreDom();
  }
});

test("App routes unsupported catalog detail paths and unknown paths to NotFound", async () => {
  for (const pathname of ["/skills/sk-1", "/tools/tl-1", "/definitely-not-real"]) {
    const restoreDom = installDomGlobals(pathname);

    try {
      const view = render(React.createElement(App));
      await view.findByText(/page not found/i);
    } finally {
      cleanup();
      restoreDom();
    }
  }
});

test("mock catalog snapshots stay immutable to callers while lookups stay consistent", () => {
  assert.equal(Object.isFrozen(catalogSpaces), true);
  assert.equal(Object.isFrozen(catalogSpaces[0]), true);

  assert.throws(() => {
    (catalogSpaces as unknown as Space[]).push({
      id: "sp-extra",
      name: "Extra",
      description: "should not mutate",
      projectCount: 0,
      status: "active",
      lastActivity: "now",
    });
  });

  const architect = getCatalogAgent("ag-1");
  assert.ok(architect);
  assert.notStrictEqual(architect, catalogAgents[0]);
  assert.deepEqual(architect, catalogAgents[0]);
  assert.equal(Object.isFrozen(architect), true);

  const platformProjects = getProjectsForSpace("sp-1");
  assert.deepEqual(
    platformProjects.map((project) => project.id),
    ["pj-1", "pj-2", "pj-3"],
  );

  assert.deepEqual(
    getAgentsForSkill("sk-1").map((agent) => agent.id),
    catalogSkills.find((skill) => skill.id === "sk-1")?.agentIds,
  );
  assert.deepEqual(
    catalogTeams.find((team) => team.id === "tm-1")?.projectIds,
    ["pj-1", "pj-2"],
  );

  const previewSections = getSettingsPreviewSections();
  assert.notStrictEqual(previewSections, getSettingsPreviewSections());
  assert.throws(() => {
    (previewSections as unknown as { id: string }[]).push({ id: "mutate" });
  });
});
