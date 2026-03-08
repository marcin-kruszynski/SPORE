function countIndent(line) {
  let indent = 0;
  while (indent < line.length && line[indent] === " ") {
    indent += 1;
  }
  return indent;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner.split(",").map((entry) => parseScalar(entry.trim()));
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseKeyValue(text) {
  const separator = text.indexOf(":");
  if (separator === -1) {
    return null;
  }
  const key = text.slice(0, separator).trim();
  const rawValue = text.slice(separator + 1);
  return { key, rawValue };
}

function isListLine(line, indent) {
  return line.startsWith(`${" ".repeat(indent)}- `);
}

function mergeObjects(target, source) {
  return { ...target, ...source };
}

function parseBlock(lines, startIndex, indent) {
  let index = startIndex;
  while (index < lines.length && !lines[index].trim()) {
    index += 1;
  }
  if (index >= lines.length) {
    return { value: null, nextIndex: index };
  }

  const currentIndent = countIndent(lines[index]);
  if (currentIndent < indent) {
    return { value: null, nextIndex: index };
  }

  if (isListLine(lines[index], indent)) {
    return parseArray(lines, index, indent);
  }
  return parseObject(lines, index, indent);
}

function parseArray(lines, startIndex, indent) {
  const result = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const currentIndent = countIndent(line);
    if (currentIndent < indent || !isListLine(line, indent)) {
      break;
    }

    const remainder = line.slice(indent + 2);
    if (!remainder.trim()) {
      const nested = parseBlock(lines, index + 1, indent + 2);
      result.push(nested.value);
      index = nested.nextIndex;
      continue;
    }

    const pair = parseKeyValue(remainder);
    if (pair) {
      let item = { [pair.key]: pair.rawValue.trim() ? parseScalar(pair.rawValue) : null };
      const nested = parseBlock(lines, index + 1, indent + 2);
      if (nested.value && typeof nested.value === "object" && !Array.isArray(nested.value)) {
        item = mergeObjects(item, nested.value);
        index = nested.nextIndex;
      } else if (nested.value !== null) {
        index = nested.nextIndex;
      } else {
        index += 1;
      }
      result.push(item);
      continue;
    }

    result.push(parseScalar(remainder));
    index += 1;
  }

  return { value: result, nextIndex: index };
}

function parseObject(lines, startIndex, indent) {
  const result = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const currentIndent = countIndent(line);
    if (currentIndent < indent) {
      break;
    }
    if (currentIndent > indent) {
      throw new Error(`invalid indentation near "${line.trim()}"`);
    }
    if (isListLine(line, indent)) {
      break;
    }

    const pair = parseKeyValue(line.trim());
    if (!pair) {
      throw new Error(`invalid YAML line: "${line.trim()}"`);
    }

    if (pair.rawValue.trim()) {
      result[pair.key] = parseScalar(pair.rawValue);
      index += 1;
      continue;
    }

    const nested = parseBlock(lines, index + 1, indent + 2);
    result[pair.key] = nested.value;
    index = nested.nextIndex;
  }

  return { value: result, nextIndex: index };
}

export function parseYaml(text) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, "  "));
  const parsed = parseBlock(lines, 0, 0);
  return parsed.value ?? {};
}
