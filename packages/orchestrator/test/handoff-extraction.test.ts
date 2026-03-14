import assert from "node:assert/strict";
import test from "node:test";

import {
  extractAgentOutputSegment,
  hasStructuredHandoffMarker,
  extractStructuredHandoffBlock,
  fallbackHandoffSummary,
} from "../src/execution/handoff-extraction.js";

test("extractAgentOutputSegment strips tool chatter before summarizing handoffs", () => {
  const transcript = [
    "Launching pi in RPC mode...",
    "[agent:start]",
    '[tool:start] read {"path":"docs/INDEX.md"}',
    "[tool:end] read error=false",
    "Scout confirmed the dashboard lacks a real day/night toggle and the builder should add one in the shared header.",
    "",
    "[SPORE_HANDOFF_JSON_BEGIN]",
    JSON.stringify(
      {
        summary: {
          title: "Scout findings",
          objective: "Keep the handoff summary clean.",
          outcome: "Builder should add the toggle in the shared header.",
          confidence: "high",
        },
        findings: ["No current toggle exists."],
        recommendations: ["Add a shared theme toggle."],
        risks: ["Token drift in light mode."],
        evidence: ["apps/web/src/components/dashboard/PageHeader.tsx"],
        scope: ["apps/web"],
        next_role: "builder",
      },
      null,
      2,
    ),
    "[SPORE_HANDOFF_JSON_END]",
    "[agent:end]",
  ].join("\n");

  const output = extractAgentOutputSegment(transcript);
  const summary = fallbackHandoffSummary(output, "scout");

  assert.doesNotMatch(output, /\[tool:start\]/);
  assert.doesNotMatch(output, /\[tool:end\]/);
  assert.match(
    summary.outcome,
    /dashboard lacks a real day\/night toggle/i,
  );
});

test("fallbackHandoffSummary ignores multiline bash tool output before the human handoff sentence", () => {
  const transcript = [
    "[agent:start]",
    '[tool:update] bash: LICENSE',
    "README.md",
    "apps",
    "packages",
    "The builder should add a shared theme toggle after wiring ThemeProvider at the app root.",
    "",
    "[SPORE_HANDOFF_JSON_BEGIN]",
    JSON.stringify({ summary: "clean summary" }, null, 2),
    "[SPORE_HANDOFF_JSON_END]",
    "[agent:end]",
  ].join("\n");

  const output = extractAgentOutputSegment(transcript);
  const summary = fallbackHandoffSummary(output, "scout");

  assert.match(summary.outcome, /builder should add a shared theme toggle/i);
  assert.doesNotMatch(summary.outcome, /^LICENSE/m);
});

test("extractStructuredHandoffBlock recovers a JSON block when the end marker is omitted", () => {
  const output = [
    "One clean sentence first.",
    '[SPORE_HANDOFF_JSON_BEGIN]{"summary":"Keep the builder scoped to the theme toggle.","next_role":"scout","scope":{"must_do":["apps/web"]},"blockers":["none"],"risks":["token drift"]}',
  ].join("\n");

  const parsed = extractStructuredHandoffBlock(output);

  assert.deepEqual(parsed, {
    summary: "Keep the builder scoped to the theme toggle.",
    next_role: "scout",
    scope: {
      must_do: ["apps/web"],
    },
    blockers: ["none"],
    risks: ["token drift"],
  });
});

test("hasStructuredHandoffMarker recognizes a recovered begin marker even when the end marker is missing", () => {
  const output =
    '[SPORE_HANDOFF_JSON_BEGIN]{"summary":"Recovered without end marker."}';

  assert.equal(hasStructuredHandoffMarker(output), true);
});

test("extractAgentOutputSegment strips multiline tool update output blocks", () => {
  const transcript = [
    "[agent:start]",
    "[tool:update] bash: first noisy line",
    "second noisy line",
    "third noisy line",
    "The human summary starts here and should survive.",
    "[agent:end]",
  ].join("\n");

  const output = extractAgentOutputSegment(transcript);

  assert.match(output, /The human summary starts here/i);
  assert.doesNotMatch(output, /second noisy line/i);
  assert.doesNotMatch(output, /third noisy line/i);
});
