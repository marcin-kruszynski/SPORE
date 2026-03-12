export function toText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function humanize(value: unknown, fallback = "Unknown") {
  const text = toText(value, fallback);
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function slugify(value: unknown, fallback = "agent") {
  const text = toText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || fallback;
}

export function parseTimestamp(value: unknown) {
  const text = toText(value, "");
  if (!text) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function isLater(candidate: string | null, current: string | null) {
  return parseTimestamp(candidate) > parseTimestamp(current);
}

export function maxTimestamp(a: string | null, b: string | null) {
  return isLater(a, b) ? a : b;
}

export function formatRelativeTimestamp(value: string | null) {
  if (!value) {
    return "No recent activity";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  const diffMs = parsed - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const absoluteMinutes = Math.abs(diffMinutes);

  if (absoluteMinutes < 1) {
    return "Updated just now";
  }
  if (absoluteMinutes < 60) {
    return `Updated ${Math.abs(diffMinutes)}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return `Updated ${Math.abs(diffHours)}h ago`;
  }

  return `Updated ${new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed))}`;
}
