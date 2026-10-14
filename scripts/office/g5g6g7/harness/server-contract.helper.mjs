// Reads the D server's own source for the harness tests (UNI-1376 r6): the
// route catalogue (server/internal/handler/router/*.go), a handler's call into
// its service, a service method's parameter names and an SDI struct's JSON
// fields. It parses text, not Go, and each lookup says what it could not find
// instead of returning an empty answer, so a refactor of the server shows up as
// a failing contract test, not as a silently skipped one.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = resolve(HERE, "..", "..", "..", "..", "server");
const ROUTER_DIR = join(SERVER_DIR, "internal", "handler", "router");
const HANDLER_DIR = join(SERVER_DIR, "internal", "handler");
const SERVICE_DIR = join(SERVER_DIR, "internal", "service");
const SDI_DIR = join(HANDLER_DIR, "dto", "sdi");

function goFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".go") && !name.endsWith("_test.go"))
    .map((name) => join(dir, name));
}

function readAll(dir) {
  return goFiles(dir).map((file) => ({ file, text: readFileSync(file, "utf8") }));
}

/** Every `x.Post("/path", h.Handler, ...)` registration, as {method, path (under /api/v1), handler}. */
export function routeCatalogue() {
  const routes = [];
  const pattern = /\.(Get|Post|Put|Patch|Delete)\(\s*"(\/[^"]*)"\s*,\s*h\.(\w+)/g;
  for (const { text } of readAll(ROUTER_DIR)) {
    for (const match of text.matchAll(pattern)) routes.push({ method: match[1].toUpperCase(), path: match[2], handler: match[3] });
  }
  return routes;
}

/** True when a concrete `method path` (without the /api/v1 prefix) is a registered route. */
export function routeMatches(routes, method, path) {
  return routes.some((route) => {
    if (route.method !== method) return false;
    const regex = new RegExp(`^${route.path.replace(/[.+*?^$()|[\]\\]/g, "\\$&").replace(/\{\w+\}/g, "[^/]+")}$`);
    return regex.test(path);
  });
}

function functionBody(text, signature) {
  const start = text.indexOf(signature);
  if (start < 0) return null;
  const end = text.indexOf("\n}\n", start);
  return text.slice(start, end < 0 ? text.length : end);
}

/** The body of the router handler method behind a `Routes` field (`CreateOrgWorkspace` -> `func (h *handlers) createOrgWorkspace`). */
export function handlerBody(routesField) {
  const router = readFileSync(join(HANDLER_DIR, "router.go"), "utf8");
  const mapped = router.match(new RegExp(`\\b${routesField}:\\s*h\\.(\\w+)`));
  if (!mapped) throw new Error(`handler/router.go maps no Routes field ${routesField}`);
  for (const { text } of readAll(HANDLER_DIR)) {
    const body = functionBody(text, `func (h *handlers) ${mapped[1]}(`);
    if (body) return body;
  }
  throw new Error(`no handler method ${mapped[1]} in ${HANDLER_DIR}`);
}

function splitArgs(argText) {
  return argText.split(",").map((part) => part.trim());
}

/**
 * What a path param is passed as: finds the handler's `h.<Service>.<Method>(...)`
 * call that takes `chi.URLParam(r, "<param>")` and the name of the service
 * method's parameter in that position. `{ method, position, name }`, or null if
 * the handler does not hand the param straight to a service call.
 */
export function pathParamTarget(routesField, param) {
  const body = handlerBody(routesField);
  const marker = `chi.URLParam(r, "${param}")`;
  const calls = [...body.replaceAll(marker, "URLPARAM").matchAll(/h\.\w+\.(\w+)\(([^\n]*URLPARAM[^\n]*)\)/g)];
  if (calls.length === 0) return null;
  const [, method, argText] = calls[0];
  const position = splitArgs(argText).findIndex((arg) => arg === "URLPARAM");
  if (position < 0) return null;
  return { method, position, name: serviceParamName(method, position) };
}

/** Parameter names of `func (s *X) Method(ctx, a, b string, c int)` in position order; throws unless exactly one such method exists. */
function serviceParamName(method, position) {
  const matches = [];
  for (const { text } of readAll(SERVICE_DIR)) {
    for (const m of text.matchAll(new RegExp(`func \\(\\w+ \\*\\w+\\) ${method}\\(([^)]*)\\)`, "g"))) matches.push(m[1]);
  }
  if (matches.length !== 1) throw new Error(`expected exactly one service method ${method}, found ${matches.length}`);
  const names = [];
  let pending = [];
  for (const part of splitArgs(matches[0].replace(/\s+/g, " "))) {
    const words = part.split(" ");
    pending.push(words[0]);
    if (words.length > 1) {
      names.push(...pending);
      pending = [];
    }
  }
  return names[position] ?? null;
}

/** Whether a service parameter name is an id or a slug, from its name; null if it says neither. */
export function paramKind(name) {
  if (/slug/i.test(name ?? "")) return "slug";
  if (/ID$/.test(name ?? "")) return "id";
  return null;
}

/**
 * An SDI struct's JSON fields: `{ <json key>: { required } }`.
 * Per docs/api-sdi-sdo.md §3/§4, required fields are non-pointer values without
 * `omitempty` that carry `minLength:"..."` (or an explicit `required:"true"` tag);
 * pointer / `omitempty` fields (`*string \`json:"comment_id,omitempty" minLength:"1"\``)
 * are optional, and their `minLength` tag bounds the value only when present.
 */
export function sdiFields(structName) {
  for (const { text } of readAll(SDI_DIR)) {
    const struct = text.match(new RegExp(`type ${structName} struct \\{([\\s\\S]*?)\\n\\}`));
    if (!struct) continue;
    const fields = {};
    for (const line of struct[1].split("\n")) {
      const json = line.match(/json:"([a-z_]+)/);
      if (json) {
        const optional = /^\s*\w+\s+\*/.test(line) || /json:"[a-z_]+,omitempty"/.test(line);
        fields[json[1]] = { required: /required:"true"/.test(line) || (!optional && /minLength:"/.test(line)) };
      }
    }
    return fields;
  }
  throw new Error(`no SDI struct ${structName} under ${SDI_DIR}`);
}

/** The text of a handler file's function, for a test that pins a form field name. */
export function handlerFunction(name) {
  for (const { text } of readAll(HANDLER_DIR)) {
    const body = functionBody(text, `func (h *handlers) ${name}(`) ?? functionBody(text, `func ${name}(`);
    if (body) return body;
  }
  throw new Error(`no handler function ${name}`);
}
