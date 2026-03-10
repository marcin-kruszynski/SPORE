import {
  classificationSeverity,
  humanizeClassification,
} from "./failure-descriptor.js";

export type ClassificationCounts = Partial<Record<string, number>>;

export interface ClassificationCarrier {
  metadata?: {
    failureClassification?: string | null;
    [key: string]: unknown;
  };
  failureClassification?: string | null;
  [key: string]: unknown;
}

export function summarizeClassificationCounts(
  items: ClassificationCarrier[] = [],
  key = "failureClassification",
): ClassificationCounts {
  return items.reduce<ClassificationCounts>((accumulator, item) => {
    const metadataValue =
      item.metadata && key in item.metadata ? item.metadata[key] : null;
    const directValue = key in item ? item[key] : null;
    const classification =
      typeof metadataValue === "string"
        ? metadataValue
        : typeof directValue === "string"
          ? directValue
          : null;
    if (!classification || classification === "success") {
      return accumulator;
    }
    accumulator[classification] = (accumulator[classification] ?? 0) + 1;
    return accumulator;
  }, {});
}

export function sortCountEntries(counts: ClassificationCounts = {}) {
  return Object.entries(counts)
    .sort(
      (left, right) =>
        Number(right[1] ?? 0) - Number(left[1] ?? 0) ||
        left[0].localeCompare(right[0]),
    )
    .map(([code, count]) => ({
      code,
      count,
      label: humanizeClassification(code),
      severity: classificationSeverity(code),
    }));
}
