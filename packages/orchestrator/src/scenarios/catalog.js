import fs from 'node:fs/promises';
import path from 'node:path';

import { parseYaml } from '../../../config-schema/src/yaml/parse-yaml.js';
import { PROJECT_ROOT } from '../../../runtime-pi/src/metadata/constants.js';

function resolvePath(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.join(PROJECT_ROOT, inputPath);
}

async function readYaml(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return parseYaml(raw);
}

async function readConfigDirectory(relativeDir) {
  const directory = resolvePath(relativeDir);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.yaml')).map((entry) => path.join(directory, entry.name)).sort();
  const items = [];
  for (const filePath of files) {
    const parsed = await readYaml(filePath);
    items.push({
      ...parsed,
      path: path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/')
    });
  }
  return items;
}

export async function listScenarioDefinitions() {
  return readConfigDirectory('config/scenarios');
}

export async function getScenarioDefinition(scenarioId) {
  const scenarios = await listScenarioDefinitions();
  return scenarios.find((scenario) => scenario.id === scenarioId) ?? null;
}

export async function listRegressionDefinitions() {
  return readConfigDirectory('config/regressions');
}

export async function getRegressionDefinition(regressionId) {
  const regressions = await listRegressionDefinitions();
  return regressions.find((regression) => regression.id === regressionId) ?? null;
}

export async function listWorkItemTemplateDefinitions() {
  return readConfigDirectory('config/work-item-templates');
}

export async function getWorkItemTemplateDefinition(templateId) {
  const templates = await listWorkItemTemplateDefinitions();
  return templates.find((template) => template.id === templateId) ?? null;
}
