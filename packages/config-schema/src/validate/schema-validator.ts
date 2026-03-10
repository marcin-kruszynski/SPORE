import type { JsonObject, SimpleSchema } from "../types.js";

function typeOf(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateType(schema: SimpleSchema, value: unknown): boolean {
  if (!schema.type) {
    return true;
  }
  if (schema.type === "integer") {
    return Number.isInteger(value);
  }
  return typeOf(value) === schema.type;
}

function validateNode(
  schema: SimpleSchema,
  value: unknown,
  pointer: string,
  errors: string[],
): void {
  if (!validateType(schema, value)) {
    errors.push(`${pointer}: expected ${schema.type}, got ${typeOf(value)}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value as never)) {
    errors.push(`${pointer}: expected one of ${schema.enum.join(", ")}`);
  }

  if (schema.type === "object") {
    if (!isJsonObject(value)) {
      return;
    }
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
    if (!schema.items || !Array.isArray(value)) {
      return;
    }
    value.forEach((item, index) => {
      validateNode(
        schema.items as SimpleSchema,
        item,
        `${pointer}[${index}]`,
        errors,
      );
    });
  }
}

export function validateAgainstSchema(
  schema: SimpleSchema,
  value: unknown,
): string[] {
  const errors: string[] = [];
  validateNode(schema, value, "$", errors);
  return errors;
}
