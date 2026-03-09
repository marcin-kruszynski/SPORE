import { spawn } from 'node:child_process';
import net from 'node:net';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForHealth(url, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // service still booting
    }
    await sleep(100);
  }
  throw new Error(`health check failed: ${url}`);
}

export async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export function startProcess(command, args, env = {}, options = {}) {
  return spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
    stdio: options.stdio ?? 'ignore'
  });
}

export async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) : null
  };
}

export async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) : null
  };
}
