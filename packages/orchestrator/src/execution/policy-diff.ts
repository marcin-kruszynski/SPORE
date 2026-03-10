function hasDisplayValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasDisplayValue(item));
  }
  if (typeof value === "object") {
    return Object.values(value).some((item) => hasDisplayValue(item));
  }
  return true;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeComparable(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => hasDisplayValue(item))
      .map((item) => normalizeComparable(item));
  }

  if (isObject(value)) {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce((accumulator, key) => {
        const item = value[key];
        if (hasDisplayValue(item)) {
          accumulator[key] = normalizeComparable(item);
        }
        return accumulator;
      }, {});
  }

  return value;
}

function signature(value) {
  return JSON.stringify(normalizeComparable(value));
}

function flattenPolicyEntries(value, path = [], entries = []) {
  if (!hasDisplayValue(value)) {
    return entries;
  }

  if (Array.isArray(value) || !isObject(value)) {
    entries.push({
      key: path.join("."),
      path,
      value,
    });
    return entries;
  }

  for (const key of Object.keys(value).sort((left, right) =>
    left.localeCompare(right),
  )) {
    const item = value[key];
    if (!hasDisplayValue(item)) {
      continue;
    }

    const nextPath = [...path, key];
    if (isObject(item) && !Array.isArray(item)) {
      flattenPolicyEntries(item, nextPath, entries);
    } else {
      entries.push({
        key: nextPath.join("."),
        path: nextPath,
        value: item,
      });
    }
  }

  return entries;
}

export function comparePolicies(baseline, candidate) {
  const baselineMap = new Map(
    flattenPolicyEntries(baseline).map((entry) => [entry.key, entry]),
  );
  const candidateMap = new Map(
    flattenPolicyEntries(candidate).map((entry) => [entry.key, entry]),
  );
  const keys = Array.from(
    new Set([...baselineMap.keys(), ...candidateMap.keys()]),
  ).sort((left, right) => left.localeCompare(right));

  const changed = [];
  const candidateOnly = [];
  const baselineOnly = [];
  let unchangedCount = 0;

  for (const key of keys) {
    const baselineEntry = baselineMap.get(key) ?? null;
    const candidateEntry = candidateMap.get(key) ?? null;

    if (baselineEntry && candidateEntry) {
      if (signature(baselineEntry.value) === signature(candidateEntry.value)) {
        unchangedCount += 1;
      } else {
        changed.push({
          key,
          path: candidateEntry.path,
          baseline: baselineEntry.value,
          candidate: candidateEntry.value,
        });
      }
      continue;
    }

    if (candidateEntry) {
      candidateOnly.push({
        key,
        path: candidateEntry.path,
        candidate: candidateEntry.value,
      });
      continue;
    }

    if (baselineEntry) {
      baselineOnly.push({
        key,
        path: baselineEntry.path,
        baseline: baselineEntry.value,
      });
    }
  }

  return {
    changed,
    candidateOnly,
    baselineOnly,
    unchangedCount,
  };
}
