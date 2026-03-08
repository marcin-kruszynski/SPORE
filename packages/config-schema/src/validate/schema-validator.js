function typeOf(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function validateType(schema, value) {
  if (!schema.type) {
    return true;
  }
  if (schema.type === "integer") {
    return Number.isInteger(value);
  }
  return typeOf(value) === schema.type;
}

function validateNode(schema, value, pointer, errors) {
  if (!validateType(schema, value)) {
    errors.push(`${pointer}: expected ${schema.type}, got ${typeOf(value)}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pointer}: expected one of ${schema.enum.join(", ")}`);
  }

  if (schema.type === "object") {
    const required = schema.required ?? [];
    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${pointer}: missing required key "${key}"`);
      }
    }
    if (!schema.properties) {
      return;
    }
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        validateNode(childSchema, value[key], `${pointer}.${key}`, errors);
      }
    }
    return;
  }

  if (schema.type === "array") {
    if (!schema.items) {
      return;
    }
    value.forEach((item, index) => {
      validateNode(schema.items, item, `${pointer}[${index}]`, errors);
    });
  }
}

export function validateAgainstSchema(schema, value) {
  const errors = [];
  validateNode(schema, value, "$", errors);
  return errors;
}
