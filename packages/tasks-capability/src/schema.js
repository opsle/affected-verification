import { readFileSync } from 'node:fs';
const cache = new Map();
function load(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Unsupported schema name');
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8')));
  return cache.get(name);
}
// Deliberately bounded validator for the JSON Schema vocabulary used by this package.
// Cross-field completeness/provenance checks remain in AV's native validator.
export function validateSchema(name, value) {
  const root = load(name);
  function check(schema, item, path, document = root, depth = 0) {
    if (depth > 80) throw new Error('Schema nesting exceeds limit');
    const fail = () => { throw new Error(`Invalid ${name} schema at ${path}`); };
    if (schema.$ref) {
      const [file, fragment] = schema.$ref.split('#');
      const doc = file ? load(file.replace('.schema.json', '')) : document;
      const target = fragment ? fragment.slice(1).split('/').reduce((v,k) => v[k], doc) : doc;
      return check(target, item, path, doc, depth + 1);
    }
    if (schema.anyOf) {
      for (const branch of schema.anyOf) {
        try { check(branch, item, path, document, depth + 1); return; } catch { /* try remaining union members */ }
      }
      fail();
    }
    if (Object.hasOwn(schema, 'const') && item !== schema.const) fail();
    if (schema.enum && !schema.enum.includes(item)) fail();
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches = type => type === undefined || (type === 'null' ? item === null
      : type === 'array' ? Array.isArray(item)
      : type === 'object' ? item !== null && typeof item === 'object' && !Array.isArray(item)
      : type === 'integer' ? Number.isSafeInteger(item)
      : type === 'number' ? typeof item === 'number' && Number.isFinite(item)
      : typeof item === type);
    if (!types.some(matches)) fail();
    if (typeof item === 'string' && ((schema.minLength && item.length < schema.minLength)
      || (schema.pattern && !new RegExp(schema.pattern).test(item)))) fail();
    if (typeof item === 'number' && schema.minimum !== undefined && item < schema.minimum) fail();
    if (Array.isArray(item)) {
      if (schema.minItems && item.length < schema.minItems) fail();
      if (schema.uniqueItems && new Set(item.map(v => JSON.stringify(v))).size !== item.length) fail();
      if (schema.items) item.forEach((v,i) => check(schema.items, v, `${path}[${i}]`, document, depth + 1));
    } else if (item !== null && typeof item === 'object') {
      for (const key of schema.required || []) if (!Object.hasOwn(item, key)) fail();
      for (const [key, v] of Object.entries(item)) {
        if (Object.hasOwn(schema.properties || {}, key)) check(schema.properties[key], v, `${path}.${key}`, document, depth + 1);
        else if (schema.additionalProperties === false) fail();
        else if (typeof schema.additionalProperties === 'object') check(schema.additionalProperties, v, `${path}.${key}`, document, depth + 1);
      }
    }
  }
  check(root, value, '$');
  return value;
}
