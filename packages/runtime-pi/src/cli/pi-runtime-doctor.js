#!/usr/bin/env node
import { spawn } from 'node:child_process';

import { resolveCommandBinary } from '../launchers/resolve-binary.js';

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code) => {
      resolve({ ok: code === 0, code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function main() {
  const piBinary = await resolveCommandBinary('pi');
  const checks = {
    node: process.execPath,
    sporePiBin: process.env.SPORE_PI_BIN ?? null,
    piBinary,
    versions: {
      node: process.version,
      npmPrefixGlobal: process.env.npm_config_prefix ?? null
    },
    checks: []
  };

  if (piBinary) {
    checks.checks.push({
      name: 'pi-version',
      ...(await run(piBinary, ['--version']))
    });
    checks.checks.push({
      name: 'pi-help',
      ...(await run(piBinary, ['--help']))
    });
  } else {
    checks.checks.push({
      name: 'pi-binary',
      ok: false,
      code: 1,
      stdout: '',
      stderr: 'pi binary not found'
    });
  }

  checks.ok = Boolean(piBinary) && checks.checks.every((item) => item.ok);
  console.log(JSON.stringify(checks, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
