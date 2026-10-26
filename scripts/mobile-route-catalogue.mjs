// Every path UniChat mobile calls, held against every route the server's router registers. The phone shipped a
// reachability probe to /api/v1/healthz that no router served (92b860efd added it), and every iPhone stayed
// offline: nothing compared the two sides. scripts/mobile-route-catalogue.test.mjs does, on every mobile change and
// on every change of server/internal/handler/router (scripts/mobile-native-scope.mjs › MOBILE_PATHS).
//
// The phone side is read with the TypeScript compiler: every string or template literal of the app's own source
// (apps/chat-mobile, tests left out) and of the core files it reaches at runtime (scripts/mobile-core-graph.mjs ›
// runtimeClosure) that is a path under /api/v1, with a file's local path builders (`const ws = (id) =>
// `/api/v1/workspaces/${enc(id)}``) inlined, whether called inside a template or handed on as they are
// (`request(msg(ws, room, id))`), and a string-literal union parameter (`route: Route`) expanded.
//
// The server side is read from the Go source of server/internal/handler/router: the `register*` functions New calls,
// followed through their `api` / chi.Router parameters, `Route` and `Group` closures and `With` chains, so each
// `.Get("/path", …)` gets the prefixes it is mounted under. Anything the reader cannot place (a registration whose
// router it cannot trace, a path it cannot evaluate, a Mount or Handle) is an issue the test fails on, never a route
// silently left out.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { root, runtimeClosure } from "./mobile-core-graph.mjs";

const ROUTER_DIR = "server/internal/handler/router";
const APP = "apps/chat-mobile";
const APP_DIRS = ["app", "components", "data", "lib", "modules"];
const API_ROOT = "/api/v1";

// ---------------------------------------------------------------------------------------------------------------
// The server: Go source of the router package.

const HTTP_METHODS = new Set(["Get", "Post", "Put", "Patch", "Delete", "Head", "Options", "Connect", "Trace"]);
/** chi registrations this reader does not follow: one on a traced router fails the check until it learns them. */
const UNSUPPORTED = new Set(["Method", "MethodFunc", "Handle", "HandleFunc", "Mount"]);

/** Go tokens with comments dropped: identifiers, strings (value unquoted), and punctuation (`:=` and `...` whole). */
function goTokens(src) {
  const out = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  const lines = (text) => (text.match(/\n/g) ?? []).length;
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line += 1;
      i += 1;
    } else if (/\s/.test(c)) {
      i += 1;
    } else if (src.startsWith("//", i)) {
      while (i < n && src[i] !== "\n") i += 1;
    } else if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      line += lines(src.slice(i, end));
      i = end + 2;
    } else if (c === '"') {
      let j = i + 1;
      let value = "";
      while (src[j] !== '"') {
        if (src[j] === "\\") {
          value += src[j + 1];
          j += 2;
        } else value += src[j++];
      }
      out.push({ t: "str", v: value, line });
      i = j + 1;
    } else if (c === "`") {
      const end = src.indexOf("`", i + 1);
      const value = src.slice(i + 1, end);
      out.push({ t: "str", v: value, line });
      line += lines(value);
      i = end + 1;
    } else if (c === "'") {
      let j = i + 1;
      while (src[j] !== "'") j += src[j] === "\\" ? 2 : 1;
      out.push({ t: "rune", v: "", line });
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /\w/.test(src[j])) j += 1;
      out.push({ t: "id", v: src.slice(i, j), line });
      i = j;
    } else if (/\d/.test(c)) {
      let j = i;
      while (j < n && /[\w.]/.test(src[j])) j += 1;
      out.push({ t: "num", v: src.slice(i, j), line });
      i = j;
    } else if (src.startsWith(":=", i) || src.startsWith("...", i)) {
      const v = src.startsWith(":=", i) ? ":=" : "...";
      out.push({ t: "p", v, line });
      i += v.length;
    } else {
      out.push({ t: "p", v: c, line });
      i += 1;
    }
  }
  return out;
}

/** For every bracket, the index of its partner. */
function brackets(toks) {
  const match = new Map();
  const stack = [];
  toks.forEach((tok, i) => {
    if (tok.t !== "p") return;
    if ("([{".includes(tok.v)) stack.push(i);
    else if (")]}".includes(tok.v)) {
      const open = stack.pop();
      match.set(open, i);
      match.set(i, open);
    }
  });
  return match;
}

/** Splits the tokens between brackets `open` and its partner at depth-0 commas: index ranges [from, to). */
function splitArgs(toks, match, open) {
  const end = match.get(open);
  const args = [];
  let from = open + 1;
  for (let i = open + 1; i < end; i++) {
    if (toks[i].t === "p" && "([{".includes(toks[i].v)) i = match.get(i);
    else if (toks[i].v === ",") {
      args.push([from, i]);
      from = i + 1;
    }
  }
  if (from < end) args.push([from, end]);
  return args;
}

/** One Go file: its functions (name, receiver, parameter names, body range) and its package-level string constants. */
function goFile(file, src) {
  const toks = goTokens(src);
  const match = brackets(toks);
  const funcs = [];
  const consts = new Map();
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok.t === "p" && "([{".includes(tok.v)) {
      // A top-level `const ( … )` block: NAME [Type] = "value".
      if (toks[i - 1]?.v === "const" && tok.v === "(") {
        for (let j = i + 1; j < match.get(i); j++) {
          if (toks[j].t === "id" && toks[j + 1]?.v === "=" && toks[j + 2]?.t === "str") consts.set(toks[j].v, toks[j + 2].v);
        }
      }
      i = match.get(i);
      continue;
    }
    if (tok.v === "const" && toks[i + 1]?.t === "id" && toks[i + 2]?.v === "=" && toks[i + 3]?.t === "str") {
      consts.set(toks[i + 1].v, toks[i + 3].v);
      continue;
    }
    if (tok.v !== "func" || tok.t !== "id") continue;
    let j = i + 1;
    let receiver = null;
    if (toks[j].v === "(") {
      receiver = toks
        .slice(j + 1, match.get(j))
        .map((t) => t.v)
        .join(" ");
      j = match.get(j) + 1;
    }
    const name = toks[j].v;
    j += 1;
    if (toks[j].v === "[") j = match.get(j) + 1;
    const params = splitArgs(toks, match, j).map(([from]) => toks[from].v);
    let k = match.get(j) + 1;
    while (toks[k].v !== "{") k = toks[k].t === "p" && "([".includes(toks[k].v) ? match.get(k) + 1 : k + 1;
    funcs.push({ file, name, receiver, params, toks, match, start: k, end: match.get(k) });
    i = match.get(k);
  }
  return { funcs, consts };
}

/**
 * Every route the router registers, as { method, path, file, line }, with the issues that would make the list wrong.
 * `sources` maps a file name to its Go source (the router package's non-test files).
 */
export function readServerRoutes(sources) {
  const funcs = new Map();
  const consts = new Map();
  for (const [file, src] of sources) {
    const parsed = goFile(file, src);
    for (const [k, v] of parsed.consts) consts.set(k, v);
    // The api wrapper's own methods (openapi.go) register whatever path they are handed: their callers are read.
    for (const fn of parsed.funcs) if (!/\bapi$/.test(fn.receiver ?? "")) funcs.set(fn.name, fn);
  }
  const issues = [];
  /** The prefixes each function's router parameters are mounted under, by parameter name. */
  const mounted = new Map([...funcs.keys()].map((name) => [name, new Map()]));

  function scan(fn, collect) {
    const { toks, match } = fn;
    const env = new Map([...mounted.get(fn.name)].map(([k, v]) => [k, new Set(v)]));
    const locals = new Map();
    const at = (i) => `${fn.file}:${toks[i].line}`;
    const add = (name, prefixes) => {
      const set = env.get(name) ?? new Set();
      for (const p of prefixes) set.add(p);
      env.set(name, set);
    };
    const evaluate = (from, to) => {
      let out = "";
      for (let i = from; i < to; i++) {
        const tok = toks[i];
        if (tok.v === "+") continue;
        if (tok.t === "str") out += tok.v;
        else if (tok.t === "id" && locals.has(tok.v)) out += locals.get(tok.v);
        else if (tok.t === "id" && consts.has(tok.v)) out += consts.get(tok.v);
        else return null;
      }
      return out;
    };
    /** The variable a call chain starts from (`x` in `x.r.With(m).Get`), given the `.` before the method. */
    const chainRoot = (dot) => {
      let j = dot - 1;
      for (;;) {
        if (toks[j]?.v === ")") {
          j = match.get(j) - 1;
          if (toks[j]?.t !== "id" || toks[j - 1]?.v !== ".") return null;
          j -= 2;
        } else if (toks[j]?.t === "id") {
          if (toks[j - 1]?.v !== ".") return toks[j].v;
          j -= 2;
        } else return null;
      }
    };
    const join = (prefix, p) => (prefix + p).replace(/(.)\/$/, "$1");
    for (let i = fn.start + 1; i < fn.end; i++) {
      const tok = toks[i];
      if (tok.t !== "id") continue;
      if (tok.v === "const" && toks[i + 1]?.t === "id" && toks[i + 2]?.v === "=" && toks[i + 3]?.t === "str") locals.set(toks[i + 1].v, toks[i + 3].v);
      // `x := …` or `x = …` (not `==`, not a field): a string, a new router, or another router's alias or With chain.
      const assigns = toks[i + 1]?.v === ":=" || (toks[i + 1]?.v === "=" && toks[i + 2]?.v !== "=" && toks[i - 1]?.v !== ".");
      if (assigns) {
        const rhs = i + 2;
        const from = toks[rhs].v;
        if (toks[rhs].t === "str" && toks[rhs + 1]?.v !== "+") locals.set(tok.v, toks[rhs].v);
        else if (from === "chi" && toks[rhs + 2]?.v === "NewRouter") add(tok.v, [""]);
        else if (from === "newAPI" && env.has(toks[rhs + 2]?.v)) add(tok.v, env.get(toks[rhs + 2].v));
        else if (env.has(from) && toks[rhs + 1]?.v === "." && toks[rhs + 2]?.v === "With") add(tok.v, env.get(from));
        else if (env.has(from) && toks[rhs + 1]?.v !== "." && toks[rhs + 1]?.v !== "(") add(tok.v, env.get(from));
      }
      if (toks[i - 1]?.v === "." && toks[i + 1]?.v === "(") {
        const recv = chainRoot(i - 1);
        const prefixes = env.get(recv);
        const args = splitArgs(toks, match, i + 1);
        if (tok.v === "Route" && prefixes) {
          const [[from, to], [fnFrom]] = args;
          const p = evaluate(from, to);
          if (p === null) issues.push(`${at(i)}: Route with a path this reader cannot evaluate`);
          else add(toks[fnFrom + 2].v, [...prefixes].map((prefix) => join(prefix, p)));
        } else if (tok.v === "Group" && prefixes) {
          add(toks[args[0][0] + 2].v, prefixes);
        } else if (HTTP_METHODS.has(tok.v) && args.length > 0) {
          const p = evaluate(args[0][0], args[0][1]);
          if (p !== null && !p.startsWith("/")) continue; // r.Header.Get("Authorization") and the like
          if (!prefixes) {
            if (p !== null) issues.push(`${at(i)}: ${tok.v}("${p}") on a router this reader cannot trace to New`);
          } else if (p === null) issues.push(`${at(i)}: ${tok.v} with a path this reader cannot evaluate`);
          else if (collect) for (const prefix of prefixes) collect({ method: tok.v.toUpperCase(), path: join(prefix, p), file: fn.file, line: toks[i].line });
        } else if (UNSUPPORTED.has(tok.v) && prefixes && collect) {
          issues.push(`${at(i)}: ${tok.v} is a registration this reader does not follow`);
        }
      }
      // A call to another function of the package hands it the prefixes of the routers it passes.
      if (funcs.has(tok.v) && toks[i + 1]?.v === "(" && toks[i - 1]?.v !== "." && toks[i - 1]?.v !== "func") {
        const callee = funcs.get(tok.v);
        splitArgs(toks, match, i + 1).forEach(([from], k) => {
          const param = callee.params[k];
          const passed = env.get(toks[from].v);
          if (!param || !passed || toks[from].t !== "id") return;
          const set = mounted.get(callee.name).get(param) ?? new Set();
          const before = set.size;
          for (const p of passed) set.add(p);
          mounted.get(callee.name).set(param, set);
          if (set.size !== before) changed = true;
        });
      }
    }
  }

  let changed = true;
  for (let pass = 0; changed && pass < 50; pass++) {
    changed = false;
    for (const fn of funcs.values()) scan(fn, null);
  }
  issues.length = 0;
  const routes = [];
  for (const fn of funcs.values()) scan(fn, (route) => routes.push(route));
  return { routes, issues: [...new Set(issues)] };
}

/** The router package's Go source, tests left out. */
export function serverSources(dir = path.join(root, ROUTER_DIR)) {
  return new Map(
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".go") && !f.endsWith("_test.go"))
      .sort()
      .map((f) => [`${ROUTER_DIR}/${f}`, fs.readFileSync(path.join(dir, f), "utf8")]),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The phone: TypeScript source of the app and the core files it runs.

/** A file's local path builders: `const name = (…) => `template``, by name. */
function builders(sf) {
  const out = new Map();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isArrowFunction(node.initializer) &&
      (ts.isTemplateExpression(node.initializer.body) || ts.isStringLiteralLike(node.initializer.body))
    ) {
      out.set(node.name.text, node.initializer.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** A file's string-literal union aliases: `type Route = "/a" | "/b"`, by name. */
function literalUnions(sf) {
  const out = new Map();
  for (const st of sf.statements) {
    if (!ts.isTypeAliasDeclaration(st) || !ts.isUnionTypeNode(st.type)) continue;
    const values = st.type.types.map((t) => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? t.literal.text : null));
    if (values.every((v) => v !== null)) out.set(st.name.text, values);
  }
  return out;
}

/** The values a parameter typed with a string-literal union can take, or null. */
function parameterChoices(id, unions) {
  for (let node = id.parent; node; node = node.parent) {
    if (!ts.isFunctionLike(node)) continue;
    const param = node.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === id.text);
    if (!param) continue;
    const type = param.type;
    return type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) ? (unions.get(type.typeName.text) ?? null) : null;
  }
  return null;
}

/** The strings an expression can only be: a literal, or a conditional between them; null for anything else. */
function literalChoices(expr) {
  if (ts.isStringLiteralLike(expr)) return [expr.text];
  if (ts.isParenthesizedExpression(expr)) return literalChoices(expr.expression);
  if (ts.isConditionalExpression(expr)) {
    const [a, b] = [literalChoices(expr.whenTrue), literalChoices(expr.whenFalse)];
    return a && b ? [...a, ...b] : null;
  }
  return null;
}

/** The values a `const` in scope holds when it is only ever a literal (`const mode = q ? "search" : "trending"`). */
function constChoices(id) {
  for (let node = id.parent; node; node = node.parent) {
    if (!ts.isBlock(node) && !ts.isSourceFile(node)) continue;
    for (const st of node.statements) {
      if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
      const decl = st.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === id.text);
      if (decl?.initializer) return literalChoices(decl.initializer);
    }
  }
  return null;
}

/** Whether `node` calls one of the file's local path builders (`msg(ws, room, id)`). */
function builderCall(node, ctx) {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ctx.builders.has(node.expression.text);
}

/** A literal as pieces: { text }, { dyn } for what is only known at runtime, or { choices } for a literal union. */
function pieces(node, ctx, depth = 0) {
  if (ts.isStringLiteralLike(node)) return [{ text: node.text }];
  if (builderCall(node, ctx)) return depth < 5 ? pieces(ctx.builders.get(node.expression.text), ctx, depth + 1) : [{ dyn: true }];
  if (ts.isParenthesizedExpression(node)) return pieces(node.expression, ctx, depth);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return [...pieces(node.left, ctx, depth), ...pieces(node.right, ctx, depth)];
  }
  if (ts.isTemplateExpression(node)) {
    const out = [{ text: node.head.text }];
    for (const span of node.templateSpans) {
      const expr = span.expression;
      if (builderCall(expr, ctx)) {
        out.push(...pieces(expr, ctx, depth));
      } else if (ts.isIdentifier(expr) && (parameterChoices(expr, ctx.unions) ?? constChoices(expr))) {
        out.push({ choices: parameterChoices(expr, ctx.unions) ?? constChoices(expr) });
      } else out.push({ dyn: true });
      out.push({ text: span.literal.text });
    }
    return out;
  }
  return [{ dyn: true }];
}

/**
 * The paths under /api/v1 the pieces name ({} for a segment known at runtime), or [] when they are not a call: a
 * label ("GET /api/v1/me"), a sentence, anything with text before /api/v1. A runtime value glued to a segment is a
 * query string (`call-logs${query}`), so the path ends there.
 */
function pathsOf(all) {
  const parts = all.filter((p) => p.text !== "");
  const at = parts.findIndex((p) => p.text?.includes(API_ROOT));
  if (at < 0 || parts.slice(0, at).some((p) => !p.dyn) || !parts[at].text.startsWith(API_ROOT)) return [];
  let paths = [""];
  let done = false;
  const segmentOpen = (p) => !p.endsWith("/") && p !== "";
  for (const part of [{ text: parts[at].text }, ...parts.slice(at + 1)]) {
    if (done) break;
    if (part.text !== undefined) {
      const cut = part.text.search(/[?#]/);
      const text = cut >= 0 ? part.text.slice(0, cut) : part.text;
      paths = paths.map((p) => p + text);
      if (cut >= 0) done = true;
    } else if (part.choices) {
      paths = paths.flatMap((p) => part.choices.map((c) => p + c));
    } else if (paths.some(segmentOpen)) {
      done = true;
    } else {
      paths = paths.map((p) => `${p}{}`);
    }
  }
  return paths.map((p) => p.replace(/(.)\/$/, "$1"));
}

/** String methods that only look at a path (`path.startsWith("/api/v1/auth/desktop/")`): their argument is no call. */
const INSPECTS = new Set(["startsWith", "endsWith", "includes", "indexOf", "lastIndexOf", "match", "replace", "replaceAll", "split", "test"]);

function comparedOnly(node) {
  const call = node.parent;
  return ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && INSPECTS.has(call.expression.name.text);
}

/** Every /api/v1 path in `sources` (file name → TypeScript source), as { path, file, line }. */
export function readPhonePaths(sources) {
  const out = [];
  for (const [file, src] of sources) {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const ctx = { builders: builders(sf), unions: literalUnions(sf) };
    const bodies = new Set(ctx.builders.values());
    const visit = (node) => {
      // A builder's own template is a prefix, not a call: its callers are read with it inlined.
      if (bodies.has(node)) return;
      // A builder handed on as it is (`request(msg(ws, room, id), { method: "PATCH" })`) is a path like a literal.
      const literal = ts.isStringLiteralLike(node) || ts.isTemplateExpression(node) || builderCall(node, ctx);
      if (literal && comparedOnly(node)) return;
      if (literal) {
        let top = node;
        while (ts.isBinaryExpression(top.parent) && top.parent.operatorToken.kind === ts.SyntaxKind.PlusToken) top = top.parent;
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        for (const p of pathsOf(pieces(top, ctx))) out.push({ path: p, file, line });
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  const seen = new Set();
  return out.filter((c) => {
    const key = `${c.path} ${c.file}:${c.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The transports a path is handed to: `request(…)`, `api.request(…)`, `fetch(…)`, `fetchStrict(…)`. */
const TRANSPORTS = new Set(["request", "fetch", "fetchStrict"]);

/** Whether `id` names a parameter of a function around it: a wrapper that forwards a path its callers build. */
function isParameter(id) {
  for (let node = id.parent; node; node = node.parent) {
    if (ts.isFunctionLike(node) && node.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === id.text)) return true;
  }
  return false;
}

/** The initializer of the `const` `id` names in a block around it, or null. */
function constInitializer(id) {
  for (let node = id.parent; node; node = node.parent) {
    if (!ts.isBlock(node) && !ts.isSourceFile(node)) continue;
    for (const st of node.statements) {
      if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
      const decl = st.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === id.text);
      if (decl) return decl.initializer ?? null;
    }
  }
  return null;
}

/**
 * Every transport call whose path readPhonePaths cannot read, as "file:line: text": the path is neither a literal,
 * a template, a local builder's call, a const holding one of those (read where it is declared), nor a parameter the
 * enclosing wrapper forwards (read at its callers). Such a call would be skipped silently, so the check fails on it.
 */
export function unreadPhoneCalls(sources) {
  const issues = [];
  for (const [file, src] of sources) {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const ctx = { builders: builders(sf), unions: literalUnions(sf) };
    const readable = (expr) =>
      ts.isStringLiteralLike(expr) || ts.isTemplateExpression(expr) || builderCall(expr, ctx) || (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken);
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const callee = node.expression;
        // `api.request(…)` is the transport; `PermissionsAndroid.request(…)`, on a capitalised module, is not.
        const onInstance = ts.isPropertyAccessExpression(callee) && !(ts.isIdentifier(callee.expression) && /^[A-Z]/.test(callee.expression.text));
        const name = ts.isIdentifier(callee) ? callee.text : onInstance ? callee.name.text : null;
        let arg = node.arguments[0];
        while (ts.isParenthesizedExpression(arg)) arg = arg.expression;
        if (name && TRANSPORTS.has(name) && !readable(arg)) {
          const init = ts.isIdentifier(arg) ? constInitializer(arg) : null;
          const ok = ts.isIdentifier(arg) && (init ? readable(init) : isParameter(arg));
          if (!ok) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            issues.push(`${file}:${line}: ${name}(${arg.getText(sf)}, …) hands on a path this reader cannot read`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return issues;
}

/** The app's own source (tests and test helpers left out) and every core file it reaches at runtime. */
export function phoneSources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!["node_modules", "android", "ios", "__tests__", "test"].includes(entry.name)) walk(rel);
      } else if (/\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) files.push(rel);
    }
  };
  for (const dir of APP_DIRS) if (fs.existsSync(path.join(root, APP, dir))) walk(`${APP}/${dir}`);
  files.push(...[...runtimeClosure()].sort());
  return new Map(files.map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")]));
}

// ---------------------------------------------------------------------------------------------------------------
// The two together.

const segments = (p) => p.split("/").filter(Boolean);

/** Whether a server pattern serves a phone path: `{param}` takes any segment, a trailing `*` the rest. */
export function serves(pattern, phonePath) {
  const server = segments(pattern);
  const phone = segments(phonePath);
  const wildcard = server.at(-1) === "*";
  if (wildcard ? phone.length < server.length - 1 : phone.length !== server.length) return false;
  return server.every((seg, i) => {
    if (seg === "*") return true;
    if (seg.startsWith("{")) return phone[i] !== undefined;
    return phone[i] === seg;
  });
}

/** The phone's calls no registered route serves (any method). */
export function unservedPaths(calls, routes) {
  const patterns = [...new Set(routes.map((r) => r.path))];
  return calls.filter((c) => !patterns.some((p) => serves(p, c.path)));
}
