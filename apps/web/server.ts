#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";

const HOST = process.env.SPORE_WEB_HOST ?? "127.0.0.1";
const PORT = Number.parseInt(process.env.SPORE_WEB_PORT ?? "8788", 10);
const GATEWAY_ORIGIN =
  process.env.SPORE_GATEWAY_ORIGIN ?? "http://127.0.0.1:8787";
const ORCHESTRATOR_ORIGIN =
  process.env.SPORE_ORCHESTRATOR_ORIGIN ?? "http://127.0.0.1:8789";
const PUBLIC_DIR = path.resolve(import.meta.dirname, "public");

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
        upstream.body as ReadableStream<Uint8Array>,
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
  const urlPath = request.url === "/" ? "/index.html" : request.url;
  const filePath = path.join(
    PUBLIC_DIR,
    path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ""),
  );
  try {
    const stats = await fs.stat(filePath);
    const targetPath = stats.isDirectory()
      ? path.join(filePath, "index.html")
      : filePath;
    const content = await fs.readFile(targetPath);
    response.writeHead(200, {
      "content-type":
        MIME_TYPES[path.extname(targetPath)] ?? "application/octet-stream",
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
