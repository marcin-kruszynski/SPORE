import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import AgentCockpitPage from "../src/pages/AgentCockpitPage.js";
import AgentLaneDetailPage from "../src/pages/AgentLaneDetailPage.js";

const testQueryClients: QueryClient[] = [];
const testRouters: Array<{ dispose?: () => void }> = [];

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

export function installDomGlobals(pathname: string) {
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

export function createTestQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
  testQueryClients.push(client);
  return client;
}

export function renderCockpit(
  initialEntry = "/cockpit",
  queryClient = createTestQueryClient(),
) {
  const router = createMemoryRouter(
    [
      {
        path: "/cockpit",
        element: React.createElement(AgentCockpitPage),
      },
      {
        path: "/cockpit/agents/:laneId",
        element: React.createElement(AgentLaneDetailPage),
      },
    ],
    {
      initialEntries: [initialEntry],
    },
  );
  testRouters.push(router);

  return {
    router,
    ...render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(RouterProvider, { router }),
      ),
    ),
  };
}

export function cleanupCockpitTestResources() {
  for (const router of testRouters.splice(0)) {
    router.dispose?.();
  }
  for (const client of testQueryClients.splice(0)) {
    client.clear();
  }
}
