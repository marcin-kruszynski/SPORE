import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ThemeProvider } from "next-themes";

import { PageHeader } from "../src/components/dashboard/PageHeader.js";
import { installDomGlobals } from "./agent-cockpit-test-utils.js";

afterEach(() => {
  cleanup();
  document.documentElement.className = "";
  if (typeof localStorage?.clear === "function") {
    localStorage.clear();
  }
});

test("PageHeader exposes a clear day/night mode toggle and applies dashboard theme classes", async () => {
  const restoreDom = installDomGlobals("/");

  const view = render(
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <PageHeader title="Dashboard" />
    </ThemeProvider>,
  );

  const initialButton = await view.findByRole("button", {
    name: /switch to (day|night) mode/i,
  });
  const initialLabel = initialButton.getAttribute("aria-label") ?? "";
  const expectLightAfterFirstClick = /switch to day mode/i.test(initialLabel);

  fireEvent.click(initialButton);
  await waitFor(() => {
    if (expectLightAfterFirstClick) {
      assert.ok(document.documentElement.classList.contains("light"));
      assert.equal(document.documentElement.classList.contains("dark"), false);
      assert.equal(
        view.getByRole("button", { name: /switch to night mode/i }).getAttribute("aria-label"),
        "Switch to night mode",
      );
      return;
    }

    assert.ok(document.documentElement.classList.contains("dark"));
    assert.equal(document.documentElement.classList.contains("light"), false);
    assert.equal(
      view.getByRole("button", { name: /switch to day mode/i }).getAttribute("aria-label"),
      "Switch to day mode",
    );
  });

  const secondButton = view.getByRole("button", {
    name: expectLightAfterFirstClick ? /switch to night mode/i : /switch to day mode/i,
  });
  fireEvent.click(secondButton);
  await waitFor(() => {
    if (expectLightAfterFirstClick) {
      assert.ok(document.documentElement.classList.contains("dark"));
      assert.equal(document.documentElement.classList.contains("light"), false);
      assert.equal(
        view.getByRole("button", { name: /switch to day mode/i }).getAttribute("aria-label"),
        "Switch to day mode",
      );
      return;
    }

    assert.ok(document.documentElement.classList.contains("light"));
    assert.equal(document.documentElement.classList.contains("dark"), false);
    assert.equal(
      view.getByRole("button", { name: /switch to night mode/i }).getAttribute("aria-label"),
      "Switch to night mode",
    );
  });

  assert.equal(view.getByRole("heading", { name: "Dashboard" }).textContent, "Dashboard");
  restoreDom();
});
