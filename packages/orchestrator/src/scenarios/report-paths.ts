export type ReportPathMap = Record<string, string>;

export interface DescribedReportPath {
  name: string;
  path: string;
}

export function normalizeReportPathMap(value: unknown): ReportPathMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([name, reportPath]) =>
        Boolean(String(name).trim()) &&
        typeof reportPath === "string" &&
        reportPath.trim().length > 0,
    ),
  );
}

export function describeReportPathMap(value: unknown): DescribedReportPath[] {
  return Object.entries(normalizeReportPathMap(value)).map(([name, path]) => ({
    name,
    path,
  }));
}

export function listReportPathValues(value: unknown): string[] {
  return Object.values(normalizeReportPathMap(value));
}
