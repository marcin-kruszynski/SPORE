#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

const HOST = process.env.SPORE_WEB_HOST ?? "127.0.0.1";
const PORT = Number.parseInt(process.env.SPORE_WEB_PORT ?? "8788", 10);
const GATEWAY_ORIGIN =
  process.env.SPORE_GATEWAY_ORIGIN ?? "http://127.0.0.1:8787";
const ORCHESTRATOR_ORIGIN =
  process.env.SPORE_ORCHESTRATOR_ORIGIN ?? "http://127.0.0.1:8789";
const DIST_DIR = path.resolve(import.meta.dirname, "dist");
const APP_SHELL_PATH = path.join(DIST_DIR, "index.html");
const PUBLIC_DIR = path.resolve(import.meta.dirname, "public");
const DIST_ASSET_PREFIXES = ["/assets/", "/chunks/"];

const DIST_ASSET_EXTENSIONS = new Set([
  ".css",
  ".gif",
  ".html",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".map",
  ".png",
  ".svg",
  ".txt",
  ".webp",
  ".woff",
  ".woff2",
]);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

type ProxyRequest = http.IncomingMessage & {
  url: string;
};

type ProxyResponse = http.ServerResponse<http.IncomingMessage>;

function sanitizeStaticPath(requestPath: string) {
  return path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
}

function isDistAssetRequest(pathname: string) {
  if (DIST_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }

  if (pathname.slice(1).includes("/")) {
    return false;
  }

  const extension = path.extname(pathname);
  return DIST_ASSET_EXTENSIONS.has(extension);
}

async function proxyRequest(request: ProxyRequest, response: ProxyResponse) {
  const gatewayTarget = request.url.startsWith("/api/orchestrator/")
    ? new URL(
        request.url.replace(/^\/api\/orchestrator/, ""),
        ORCHESTRATOR_ORIGIN,
      )
    : new URL(request.url.replace(/^\/api/, ""), GATEWAY_ORIGIN);
  const init: RequestInit & { headers: Record<string, string> } = {
    method: request.method,
    headers: {
      "content-type": request.headers["content-type"] ?? "application/json",
    },
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    init.body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  }

  const upstream = await fetch(gatewayTarget, init);
  const contentType =
    upstream.headers.get("content-type") ?? "application/json; charset=utf-8";
  if (contentType.startsWith("text/event-stream")) {
    response.writeHead(upstream.status, {
      "content-type": contentType,
      "cache-control":
        upstream.headers.get("cache-control") ?? "no-cache, no-transform",
      connection: "keep-alive",
    });
    if (upstream.body) {
      const bodyStream = Readable.fromWeb(
        upstream.body as NodeReadableStream<Uint8Array>,
      );
      bodyStream.on("error", () => {
        if (!response.writableEnded) {
          response.end();
        }
      });
      response.on("close", () => {
        bodyStream.destroy();
      });
      bodyStream.pipe(response);
      return;
    }
  }
  response.writeHead(upstream.status, {
    "content-type": contentType,
  });
  const body = Buffer.from(await upstream.arrayBuffer());
  response.end(body);
}

async function serveStatic(request: ProxyRequest, response: ProxyResponse) {
  const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
  const { pathname } = requestUrl;

  if (pathname === "/legacy-dashboard" || pathname.startsWith("/legacy-dashboard/")) {
    const legacyPath = pathname.replace(/^\/legacy-dashboard/, "") || "/index.html";
    const filePath = path.join(
      PUBLIC_DIR,
      sanitizeStaticPath(legacyPath),
    );
    try {
      const stats = await fs.stat(filePath);
      const targetPath = stats.isDirectory()
        ? path.join(filePath, "index.html")
        : filePath;
      let content = await fs.readFile(targetPath);
      if (path.extname(targetPath) === ".html") {
        content = Buffer.from(
          content
            .toString("utf8")
            .replaceAll('href="/styles.css"', 'href="/legacy-dashboard/styles.css"')
            .replaceAll('src="/main.js"', 'src="/legacy-dashboard/main.js"'),
        );
      }
      response.writeHead(200, {
        "content-type":
          MIME_TYPES[path.extname(targetPath)] ?? "application/octet-stream",
      });
      response.end(content);
      return;
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }
  }

  if (isDistAssetRequest(pathname)) {
    const filePath = path.join(
      DIST_DIR,
      sanitizeStaticPath(pathname),
    );
    try {
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        "content-type":
          MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      });
      response.end(content);
      return;
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }
  }

  try {
    const content = await fs.readFile(APP_SHELL_PATH);
    response.writeHead(200, {
      "content-type": MIME_TYPES[".html"],
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const normalizedRequest = request as ProxyRequest;
    if (normalizedRequest.url.startsWith("/api/")) {
      await proxyRequest(normalizedRequest, response);
      return;
    }
    await serveStatic(normalizedRequest, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.writeHead(500, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(`${JSON.stringify({ ok: false, error: message })}\n`);
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        service: "spore-web",
        host: HOST,
        port: PORT,
        gatewayOrigin: GATEWAY_ORIGIN,
        orchestratorOrigin: ORCHESTRATOR_ORIGIN,
      },
      null,
      2,
    )}\n`,
  );
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  process.stderr.write(`spore-web shutdown: ${signal}\n`);
  server.close(() => {
    process.exitCode = process.exitCode ?? 0;
  });
  const timer = setTimeout(() => {
    process.exitCode = 1;
    process.exit();
  }, 5_000);
  timer.unref?.();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
