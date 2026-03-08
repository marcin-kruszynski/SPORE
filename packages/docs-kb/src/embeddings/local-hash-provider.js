import { tokenize } from "../metadata/helpers.js";

const DIMENSIONS = 128;

function createEmptyVector() {
  return new Array(DIMENSIONS).fill(0);
}

function normalizeVector(vector) {
  let magnitude = 0;
  for (const value of vector) {
    magnitude += value * value;
  }
  magnitude = Math.sqrt(magnitude);
  if (magnitude === 0) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}

function hashToken(token) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export const localHashProvider = {
  id: "local-hash-v1",
  dimensions: DIMENSIONS,
  embed(text) {
    const vector = createEmptyVector();
    const tokens = tokenize(text);

    for (const token of tokens) {
      const hash = hashToken(token);
      const bucket = hash % DIMENSIONS;
      const sign = hash & 1 ? 1 : -1;
      vector[bucket] += sign;
    }

    return normalizeVector(vector);
  }
};
