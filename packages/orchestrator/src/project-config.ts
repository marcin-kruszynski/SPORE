import fs from "node:fs";
import path from "node:path";

import { parseYaml } from "@spore/config-schema";
import { PROJECT_ROOT } from "@spore/core";

type LooseRecord = Record<string, unknown>;

const DEFAULTS_PATH = path.join(PROJECT_ROOT, "config/system/defaults.yaml");
const PROJECTS_DIR = path.join(PROJECT_ROOT, "config/projects");
const DOMAINS_DIR = path.join(PROJECT_ROOT, "config/domains");

function readYamlSync(filePath: string): LooseRecord {
  return parseYaml(fs.readFileSync(filePath, "utf8")) as LooseRecord;
}

function normalizeText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function getDefaultProjectId() {
  try {
    const defaults = readYamlSync(DEFAULTS_PATH);
    const configured = normalizeText(defaults.defaultProjectId, "");
    if (configured) {
      return configured;
    }
  } catch {
    // fall through to project discovery
  }

  try {
    const entries = fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => entry.name.replace(/\.yaml$/, ""))
      .sort();
    if (entries.length > 0) {
      return entries[0] ?? "spore";
    }
  } catch {
    // final fallback below
  }

  return "spore";
}

export function normalizeProjectRef(projectRef?: unknown) {
  return normalizeText(projectRef, getDefaultProjectId());
}

export function resolveProjectConfigPath(projectRef?: unknown) {
  const normalized = normalizeProjectRef(projectRef);
  if (normalized.includes("/") || normalized.endsWith(".yaml")) {
    return path.isAbsolute(normalized)
      ? normalized
      : path.join(PROJECT_ROOT, normalized);
  }
  return path.join(PROJECT_ROOT, "config/projects", `${normalized}.yaml`);
}

export function normalizeProjectConfigPath(projectRef?: unknown) {
  return path.relative(PROJECT_ROOT, resolveProjectConfigPath(projectRef));
}

export function listDomainConfigsSync() {
  try {
    const entries = fs
      .readdirSync(DOMAINS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .sort((left, right) => left.name.localeCompare(right.name));
    return entries.map((entry) => {
      const filePath = path.join(DOMAINS_DIR, entry.name);
      const config = readYamlSync(filePath);
      return {
        id: normalizeText(config.id, entry.name.replace(/\.yaml$/, "")),
        pathPrefixes: Array.isArray(config.pathPrefixes)
          ? config.pathPrefixes.map((value) => String(value)).filter(Boolean)
          : [],
        taskClass: normalizeText(config.taskClass, ""),
      };
    });
  } catch {
    return [];
  }
}
