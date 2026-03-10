export type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type YamlScalar = JsonPrimitive;

export interface YamlObject {
  [key: string]: YamlValue;
}

export type YamlValue = YamlScalar | YamlObject | YamlValue[];

export type SchemaNodeType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

export interface SimpleSchema {
  type?: SchemaNodeType;
  enum?: JsonPrimitive[];
  required?: string[];
  properties?: Record<string, SimpleSchema>;
  items?: SimpleSchema;
}

export interface ValidationResult {
  file: string;
  valid: boolean;
  errors: string[];
}

export interface ParsedArgs<
  TFlags extends Record<string, string | boolean | undefined>,
> {
  positional: string[];
  flags: TFlags;
}
