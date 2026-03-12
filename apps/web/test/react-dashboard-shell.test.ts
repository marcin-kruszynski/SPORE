import assert from "node:assert/strict";
import test from "node:test";

import {
  findFreePort,
  startProcess,
  stopProcess,
  waitForHealth,
} from "@spore/test-support";

import { ensureWebRuntimeBuilt } from "./runtime-harness.js";

test("react dashboard shell serves SPA routes and preserves legacy route isolation", async (t) => {
  await ensureWebRuntimeBuilt();

  const webPort = await findFreePort();
  const web = startProcess("node", ["apps/web/server.ts"], {
    SPORE_WEB_PORT: String(webPort),
    SPORE_ORCHESTRATOR_ORIGIN: "http://127.0.0.1:65535",
    SPORE_GATEWAY_ORIGIN: "http://127.0.0.1:65534",
  });

  t.after(async () => {
    await stopProcess(web);
  });

  const webOrigin = `http://127.0.0.1:${webPort}`;
  await waitForHealth(`${webOrigin}/`);

  const rootResponse = await fetch(`${webOrigin}/`);
  assert.equal(rootResponse.status, 200);
  const rootHtml = await rootResponse.text();
  assert.match(rootHtml, /<div id="root"><\/div>/);
  assert.ok(!rootHtml.includes("/main.js"));
  assert.ok(!rootHtml.includes("/styles.css"));

  const missionMapResponse = await fetch(`${webOrigin}/mission-map`);
  assert.equal(missionMapResponse.status, 200);
  const missionMapHtml = await missionMapResponse.text();
  assert.match(missionMapHtml, /<div id="root"><\/div>/);

  const dottedRouteResponse = await fetch(`${webOrigin}/projects/foo.bar`);
  assert.equal(dottedRouteResponse.status, 200);
  const dottedRouteHtml = await dottedRouteResponse.text();
  assert.match(dottedRouteHtml, /<div id="root"><\/div>/);

  const jsonLikeRouteResponse = await fetch(`${webOrigin}/projects/foo.json`);
  assert.equal(jsonLikeRouteResponse.status, 200);
  const jsonLikeRouteHtml = await jsonLikeRouteResponse.text();
  assert.match(jsonLikeRouteHtml, /<div id="root"><\/div>/);

  const jsLikeRouteResponse = await fetch(`${webOrigin}/agents/acme.js`);
  assert.equal(jsLikeRouteResponse.status, 200);
  const jsLikeRouteHtml = await jsLikeRouteResponse.text();
  assert.match(jsLikeRouteHtml, /<div id="root"><\/div>/);

  const legacyResponse = await fetch(`${webOrigin}/legacy-dashboard`);
  assert.equal(legacyResponse.status, 200);
  const legacyHtml = await legacyResponse.text();
  assert.ok(legacyHtml.includes("Operator Console"));
  assert.ok(legacyHtml.includes('/legacy-dashboard/styles.css'));
  assert.ok(legacyHtml.includes('/legacy-dashboard/main.js'));

  const legacyCssResponse = await fetch(`${webOrigin}/legacy-dashboard/styles.css`);
  assert.equal(legacyCssResponse.status, 200);
  const legacyCss = await legacyCssResponse.text();
  assert.ok(legacyCss.includes(".view-nav"));

  const legacyJsResponse = await fetch(`${webOrigin}/legacy-dashboard/main.js`);
  assert.equal(legacyJsResponse.status, 200);
  assert.match(
    legacyJsResponse.headers.get("content-type") ?? "",
    /text\/javascript/,
  );
  const legacyJs = await legacyJsResponse.text();
  assert.ok(legacyJs.includes("operator-thread-form"));

  const leakedMainResponse = await fetch(`${webOrigin}/main.js`);
  assert.equal(leakedMainResponse.status, 404);

  const leakedStylesResponse = await fetch(`${webOrigin}/styles.css`);
  assert.equal(leakedStylesResponse.status, 404);

  const missingAssetResponse = await fetch(`${webOrigin}/missing-app.js`);
  assert.equal(missingAssetResponse.status, 404);

  const missingBuiltAssetResponse = await fetch(`${webOrigin}/assets/missing-shell.js`);
  assert.equal(missingBuiltAssetResponse.status, 404);
});
