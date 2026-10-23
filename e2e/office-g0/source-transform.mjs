// DOC-003 renderer source transform (UNI-667).
//
// The deterministic core the build script uses to rewrite the prepared GenOffice
// renderer sources. It is pure: text in, new text plus a report out, so it can be
// unit-tested without a filesystem and the same input always produces
// byte-identical output.
//
// What it rewrites
// ----------------
//   window.desktop              -> __labHost('desktop')
//   window.desktop?.saveDocx    -> __labHost('desktop')?.saveDocx
//   (window as any).projectApi  -> __labHost('projectApi')
//   window['slidesApi']         -> __labHost('slidesApi')
//   (window as any)['slidesApi']-> __labHost('slidesApi')
//
// The rewrite is TypeScript-aware: it parses each module and only rewrites host
// globals in VALUE position. A "typeof window.x" type query is erased by the
// compiler, so it is left byte-for-byte untouched; rewriting it is what previously
// produced invalid output. The parser is injected by the caller (transformSource).
// The same walk reports result.survivors, so the rewrite and its own containment
// check share one definition of value position instead of a second, text-based one.
//
// and it prepends one import of the injected accessor per module, through the lab
// alias, so a transformed file does not depend on its own depth in the tree. The
// replacement is a read of the injected host: never an assignment, never a Proxy,
// never a fallback that answers null. Anything unrecognised is left untouched and
// reported as a miss, and any miss fails the build.

import { HOST_SURFACE } from './host-surface.mjs';

/** The renderer globals the prepared source reads. */
export const HOST_GLOBAL_NAMES = [
  'desktop',
  'desktopApi',
  'markdownApi',
  'htmlApi',
  'pdfApi',
  'slidesApi',
  'projectApi',
  'filesPaneApi',
];

/** Escapes the regex metacharacters that can appear in a global name. */
const escapeRegExp = (value) => value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

/** The accessor the transformed modules call. */
export const HOST_ACCESSOR = '__labHost';

/** The alias the build config maps to e2e/office-g0/host-runtime.mjs. */
export const HOST_RUNTIME_ALIAS = '@lab/host-runtime';

const DQ = String.fromCharCode(34);

/** The one import line the transform prepends; exported so tests assert this literal. */
export const IMPORT_LINE =
  'import { labHostGlobal as ' + HOST_ACCESSOR + ' } from ' + DQ + HOST_RUNTIME_ALIAS + DQ + ';\n';

/** Thrown when the caller did not inject the TypeScript compiler. */
export function missingParserError() {
  return new Error(
    'transformSource needs the TypeScript compiler: pass { typescript } (see scripts/office-g0/build-renderers.mjs)',
  );
}

/** Which TypeScript ScriptKind each transformable extension parses as. */
export const SCRIPT_KIND_BY_EXTENSION = {
  '.ts': 'TS',
  '.mts': 'TS',
  '.cts': 'TS',
  '.tsx': 'TSX',
  '.jsx': 'JSX',
  '.js': 'JS',
  '.mjs': 'JS',
  '.cjs': 'JS',
};

/** The lower-case extension of a posix path, including the dot, or an empty string. */
function extensionOf(fileName) {
  const lower = String(fileName).toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot === -1 ? '' : lower.slice(dot);
}

/** The ScriptKind one relative path parses as; TSX is the safe default for JSX trees. */
export function scriptKindForPath(typescript, relativePath) {
  return typescript.ScriptKind[SCRIPT_KIND_BY_EXTENSION[extensionOf(relativePath)] ?? 'TSX'];
}



/** The read expression a transformed module uses for one global. */
export function hostReadExpression(globalName, accessor = HOST_ACCESSOR) {
  return accessor + '(' + JSON.stringify(globalName) + ')';
}

const isWindowIdentifier = (typescript, node) => typescript.isIdentifier(node) && node.text === 'window';

/** Strips the wrappers that do not change a value read: (x), x! and <T>x. */
function unwrap(typescript, node) {
  let current = node;
  while (
    typescript.isParenthesizedExpression(current) ||
    typescript.isNonNullExpression(current) ||
    typescript.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The `as T` / `satisfies T` / `<T>` cast node when it casts a window identifier. */
function windowCast(typescript, node) {
  const expression = unwrap(typescript, node);
  const isAssertion =
    typescript.isAsExpression(expression) ||
    typescript.isSatisfiesExpression(expression) ||
    typescript.isTypeAssertionExpression(expression);
  if (!isAssertion) return null;
  return isWindowIdentifier(typescript, unwrap(typescript, expression.expression)) ? expression : null;
}

/** The literal global name in a bracket argument, through casts and parentheses. */
function literalGlobalName(typescript, node) {
  if (!node) return null;
  if (typescript.isStringLiteralLike(node)) return node.text;
  const isWrapper =
    typescript.isAsExpression(node) ||
    typescript.isSatisfiesExpression(node) ||
    typescript.isTypeAssertionExpression(node) ||
    typescript.isParenthesizedExpression(node) ||
    typescript.isNonNullExpression(node);
  return isWrapper ? literalGlobalName(typescript, node.expression) : null;
}

// Whole-module binding detection deliberately rejects even unrelated scopes.
function hasValueBinding(typescript, sourceFile, name) {
  let found = false;
  const note = (bindingName) => {
    if (!bindingName || found) return;
    if (typescript.isIdentifier(bindingName)) {
      if (bindingName.text === name) found = true;
      return;
    }
    for (const element of bindingName.elements) {
      if (typescript.isBindingElement(element)) note(element.name);
    }
  };
  const visit = (node) => {
    if (found) return;
    if (typescript.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause && clause.isTypeOnly !== true) {
        if (clause.name) note(clause.name);
        const bindings = clause.namedBindings;
        if (bindings && typescript.isNamespaceImport(bindings)) {
          note(bindings.name);
        } else if (bindings && typescript.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (element.isTypeOnly !== true) note(element.name);
          }
        }
      }
    } else if (typescript.isImportEqualsDeclaration(node)) {
      if (node.isTypeOnly !== true) note(node.name);
    } else if (typescript.isVariableDeclaration(node) || typescript.isParameter(node)) {
      note(node.name);
    } else if (typescript.isFunctionDeclaration(node) || typescript.isFunctionExpression(node)) {
      note(node.name);
    } else if (typescript.isClassDeclaration(node) || typescript.isClassExpression(node)) {
      note(node.name);
    } else if (typescript.isEnumDeclaration(node)) {
      note(node.name);
    } else if (typescript.isCatchClause(node) && node.variableDeclaration) {
      note(node.variableDeclaration.name);
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

// An intrinsic symbol key cannot name a string preload global.
function isProvableSymbolKey(typescript, sourceFile, node) {
  const key = unwrap(typescript, node);
  if (!typescript.isCallExpression(key) || key.questionDotToken) return false;
  const callee = unwrap(typescript, key.expression);
  if (!typescript.isPropertyAccessExpression(callee) || callee.questionDotToken) return false;
  if (callee.name.text !== 'for' || key.arguments.length !== 1) return false;
  const receiver = unwrap(typescript, callee.expression);
  if (!typescript.isIdentifier(receiver) || receiver.text !== 'Symbol') return false;
  if (!typescript.isStringLiteralLike(unwrap(typescript, key.arguments[0]))) return false;
  return !hasValueBinding(typescript, sourceFile, 'Symbol');
}

/** The outermost node of a postfix property/element access chain rooted at `node`. */
function accessChainTop(typescript, node) {
  let current = node;
  let parent = current.parent;
  while (
    parent &&
    (typescript.isPropertyAccessExpression(parent) || typescript.isElementAccessExpression(parent)) &&
    parent.expression === current
  ) {
    current = parent;
    parent = current.parent;
  }
  return current;
}

/**
 * True when the access chain `node` belongs to is erased before emit, so it must be left
 * byte-for-byte intact: a type query, an interface heritage clause, a computed key of a
 * type literal/mapped/function type, or any node that is itself a type annotation.
 * A runtime `typeof`, a class `extends`/`implements`, and an object-literal or class
 * computed value are value code and return false. The decision is made from the chain's
 * context only, so a mixed node (ExpressionWithTypeArguments, a type annotation that is
 * the initializer of a value) is never skipped wholesale.
 */
function isTypeOnlyExpression(typescript, node) {
  const top = accessChainTop(typescript, node);
  const parent = top.parent;
  if (!parent) return false;
  if (typescript.isTypeQueryNode(parent) && unwrap(typescript, parent.exprName) === top) return true;
  if (typescript.isExportAssignment(parent) && unwrap(typescript, parent.expression) === top) return false;
  if (typescript.isExpressionWithTypeArguments(parent)) {
    const owner = parent.parent && parent.parent.parent;
    return !!(owner && typescript.isInterfaceDeclaration(owner));
  }
  if (typescript.isComputedPropertyName(parent) && parent.expression === top) {
    const owner = parent.parent;
    if (!owner) return false;
    return (
      typescript.isTypeLiteralNode(owner) ||
      typescript.isInterfaceDeclaration(owner) ||
      typescript.isFunctionOrConstructorTypeNode(owner) ||
      typescript.isPropertySignature(owner)
    );
  }
  return typescript.isTypeNode(parent) && !typescript.isExpressionWithTypeArguments(parent);
}

/**
 * True when the read is the target of a real assignment operator, `++`/`--` or `delete`,
 * through any transparent parentheses/cast/non-null wrapper. An equality, logical or any
 * other unary operand is a read, not a write: treating every binary left operand and every
 * prefix operand as a write refused `window.desktop === undefined`, `window.desktop && x`
 * and `!window.desktop` and made the real rewrite disappear.
 */
// Assignment targets can be wrapped in casts as well as parentheses.
const isTransparentValueWrapper = (typescript, node) =>
  typescript.isParenthesizedExpression(node) ||
  typescript.isNonNullExpression(node) ||
  typescript.isTypeAssertionExpression(node) ||
  typescript.isAsExpression(node) ||
  typescript.isSatisfiesExpression(node);

const isWriteTarget = (typescript, node) => {
  let current = node;
  let parent = current.parent;
  while (parent && isTransparentValueWrapper(typescript, parent)) {
    current = parent;
    parent = current.parent;
  }
  if (!parent) return false;
  if (typescript.isBinaryExpression(parent)) {
    return parent.left === current && typescript.isAssignmentOperator(parent.operatorToken.kind);
  }
  if (typescript.isPrefixUnaryExpression(parent) || typescript.isPostfixUnaryExpression(parent)) {
    return (
      parent.operand === current &&
      (parent.operator === typescript.SyntaxKind.PlusPlusToken ||
        parent.operator === typescript.SyntaxKind.MinusMinusToken)
    );
  }
  if (typescript.isDeleteExpression(parent)) return parent.expression === current;
  return false;
};

/**
 * One walk over a parsed module reporting every host global read in value position.
 * The rewrite and the survivor check share it, so "value position" has a single
 * definition: a type node (`typeof window.x` here is a type query) is erased before
 * emit and is never reported, while a runtime `typeof window.x` is value code and is;
 * comments and strings are structurally out of reach. A dynamic bracket read is a
 * miss because the global it may name cannot be proven from the AST.
 */
function collectHostReads(typescript, sourceFile, { onRead, onMiss }) {
  const isHostGlobal = (name) => HOST_GLOBAL_NAMES.includes(name);
  const looksLikeHostGlobal = (name) =>
    /^(desktop|markdown|html|pdf|slides|project|files)[A-Za-z0-9_$]*$/.test(name) && !isHostGlobal(name);
  const missUnrecognised = (name) =>
    onMiss({ global: name, reason: 'looks like a host global but is not in the known set' });
  const missAssignment = (name) =>
    onMiss({ global: name, reason: 'assignment to a window host global; the lab host must stay imported' });
  const visit = (node) => {
    if (typescript.isPropertyAccessExpression(node)) {
      const baseIsWindow = isWindowIdentifier(typescript, unwrap(typescript, node.expression));
      const cast = windowCast(typescript, node.expression);
      if (baseIsWindow || cast) {        const name = node.name.text;
        if (!isHostGlobal(name)) {
          if (looksLikeHostGlobal(name) && !isTypeOnlyExpression(typescript, node)) missUnrecognised(name);
        } else if (!isTypeOnlyExpression(typescript, node)) {
          if (isWriteTarget(typescript, node)) missAssignment(name);
          else onRead({ global: name, start: node.getStart(sourceFile), end: node.name.end });
        }
      }
    } else if (typescript.isElementAccessExpression(node)) {
      const baseIsWindow = isWindowIdentifier(typescript, unwrap(typescript, node.expression));
      const cast = windowCast(typescript, node.expression);
      if (baseIsWindow || cast) {        const name = literalGlobalName(typescript, node.argumentExpression);
        if (name === null) {
          if (!isTypeOnlyExpression(typescript, node) && !isProvableSymbolKey(typescript, sourceFile, node.argumentExpression)) {
            onMiss({
              global: node.argumentExpression.getText(sourceFile),
              reason:
                'dynamic window bracket read; rewrite it as a literal window["<global>"] read the transform can prove safe',
            });
          }
        } else if (!isHostGlobal(name)) {
          if (looksLikeHostGlobal(name) && !isTypeOnlyExpression(typescript, node)) missUnrecognised(name);
        } else if (!isTypeOnlyExpression(typescript, node)) {
          if (isWriteTarget(typescript, node)) missAssignment(name);
          else onRead({ global: name, start: node.getStart(sourceFile), end: node.end });
        }
      }
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/**
 * Whether the module already carries the expected value import of the accessor (a
 * type-only import does not count: the compiler erases it, so a rewritten call would
 * be free), plus every value binding at any depth that would collide with the
 * accessor name. A collision is a miss, not a silent shadow.
 */
function accessorBindings(typescript, sourceFile) {
  const collisions = [];
  let hasExpectedImport = false;
  const isExpectedImport = (statement) =>
    typescript.isImportDeclaration(statement) &&
    typescript.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === HOST_RUNTIME_ALIAS &&
    !!statement.importClause &&
    statement.importClause.isTypeOnly !== true &&
    !!statement.importClause.namedBindings &&
    typescript.isNamedImports(statement.importClause.namedBindings) &&    statement.importClause.namedBindings.elements.some(
      (element) =>
        element.propertyName &&
        element.propertyName.text === 'labHostGlobal' &&
        element.name.text === HOST_ACCESSOR &&
        element.isTypeOnly !== true,
    );
  const note = (name) => {
    if (!name) return;
    if (typescript.isIdentifier(name)) {
      if (name.text === HOST_ACCESSOR) collisions.push(HOST_ACCESSOR);
      return;
    }
    for (const element of name.elements) {
      if (typescript.isBindingElement(element)) note(element.name);
    }
  };
  const walked = (node) => {
    if (typescript.isImportDeclaration(node)) {
      if (isExpectedImport(node)) {
        hasExpectedImport = true;
        return;
      }
      const clause = node.importClause;
      if (!clause || clause.isTypeOnly === true) return;
      if (clause.name) note(clause.name);
      if (clause.namedBindings && typescript.isNamespaceImport(clause.namedBindings)) {
        note(clause.namedBindings.name);
      } else if (clause.namedBindings && typescript.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          if (element.isTypeOnly !== true) note(element.name);
        }
      }
      return;
    }
    if (typescript.isImportEqualsDeclaration(node)) {
      if (node.isTypeOnly !== true) note(node.name);
      return;
    }
    if (typescript.isVariableDeclaration(node) || typescript.isParameter(node)) note(node.name);
    else if (typescript.isFunctionDeclaration(node) || typescript.isFunctionExpression(node)) note(node.name);
    else if (typescript.isClassDeclaration(node) || typescript.isClassExpression(node)) note(node.name);
    typescript.forEachChild(node, walked);
  };
  walked(sourceFile);
  return { hasExpectedImport, collisions };
}

/**
 * Host globals a text still reads in value position, judged by the AST of that text
 * (comments, strings and type-only positions cannot register; cast bracket reads and
 * runtime `typeof` reads do). Used for the rewritten module and for transpiled bundle
 * output, where the source-stage rewrite oracle no longer applies.
 */
export function emittedHostGlobalSurvivors(typescript, text, { fileName = 'emitted.js', scriptKind } = {}) {
  if (!typescript || typeof typescript.createSourceFile !== 'function') throw missingParserError();
  const kind =
    scriptKind ??
    (/\.[cm]?tsx?$/.test(fileName) ? scriptKindForPath(typescript, fileName) : typescript.ScriptKind.JS);
  const sourceFile = typescript.createSourceFile(fileName, text, typescript.ScriptTarget.Latest, true, kind);
  const survivors = [];  collectHostReads(typescript, sourceFile, {
    onRead: (read) => {
      if (!survivors.includes(read.global)) survivors.push(read.global);
    },
    onMiss: (miss) => {
      // A refused access (a write target, an unknown lookalike, a dynamic bracket) is a
      // live host access the rewrite could not contain; it must not disappear from the
      // verdict. A miss that vanished was how `window.desktop === undefined` passed.
      if (!survivors.includes(miss.global)) survivors.push(miss.global);
    },
  });
  return survivors;
}

/**
 * Rewrites every window host-global read in one file onto the injected host.
 *
 * @param {string} source      the original module text
 * @param {object} options
 * @param {string} options.app           which app the file belongs to
 * @param {string} options.relativePath  the file path, for the report and the parse kind
 * @param {object} options.typescript    the TypeScript compiler, injected by the caller
 */
export function transformSource(source, { app, relativePath = '', typescript } = {}) {
  if (typeof source !== 'string') throw new Error('transformSource: source text is required');
  if (!HOST_SURFACE[app]) throw new Error('transformSource: unknown app ' + app);
  if (!typescript || typeof typescript.createSourceFile !== 'function') throw missingParserError();

  const fileName = relativePath || 'module.tsx';
  const scriptKind = scriptKindForPath(typescript, fileName);
  const sourceFile = typescript.createSourceFile(
    fileName,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const diagnosticsBefore = sourceFile.parseDiagnostics.length;

  const edits = [];
  const misses = [];
  const claimed = [];
  const isClaimed = (start, end) => claimed.some(([a, b]) => start < b && end > a);
  const record = (start, end, globalName) => {
    if (isClaimed(start, end)) return;
    claimed.push([start, end]);
    edits.push({ global: globalName, start, end, replacement: hostReadExpression(globalName) });
  };

  // One AST walk decides what is rewritten. Type queries are type nodes, so they are
  // still left byte-for-byte alone; the same walk is the survivor oracle below.
  collectHostReads(typescript, sourceFile, {
    onRead: (read) => record(read.start, read.end, read.global),
    onMiss: (miss) => misses.push(miss),
  });

  let text = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  }

  // Only a real value binding for the accessor suppresses the injected import: a
  // string, a comment or a type-only import must not. A binding that would collide
  // anywhere in the module is a miss, and the import is not injected beside it.
  const bindings = accessorBindings(typescript, sourceFile);
  for (const name of bindings.collisions) {
    misses.push({
      global: name,
      reason: 'a local binding would shadow the injected host accessor; rename it',
    });
  }
  const withImport =
    edits.length > 0 && !bindings.hasExpectedImport && bindings.collisions.length === 0
      ? IMPORT_LINE + text
      : text;

  // Independent oracle: re-parse the emitted bytes and read the AST that comes back,
  // so the verdict cannot be satisfied by a comment or a string that merely mentions
  // a global. Diagnostics are reported, not thrown, so a module that already carried
  // them is still checked, and they are compared as counts rather than asserted zero.
  const emittedFile = typescript.createSourceFile(
    fileName,
    withImport,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind,
  );  const survivors = [];
  collectHostReads(typescript, emittedFile, {
    onRead: (read) => {
      if (!survivors.includes(read.global)) survivors.push(read.global);
    },
    // Same rule as the exported oracle: a refused access is still a live access.
    onMiss: (miss) => {
      if (!survivors.includes(miss.global)) survivors.push(miss.global);
    },
  });
  const diagnosticsAfter = emittedFile.parseDiagnostics.length;
  if (diagnosticsAfter > diagnosticsBefore) {
    misses.push({
      global: 'parse-diagnostics',
      reason: 'the rewrite introduces parser diagnostics; refusing to write invalid output',
    });
  }

  const normalizedEdits = edits.map((edit) => ({
    global: edit.global,
    start: edit.start,
    end: edit.end,
  }));
  return {
    text: withImport,
    edits: normalizedEdits,
    misses,
    survivors,
    relativePath,
    parseDiagnosticsBefore: diagnosticsBefore,
    parseDiagnosticsAfter: diagnosticsAfter,
  };
}

/** Rewrites a whole tree in memory and totals the edits and misses. */
export function transformTree(files, { app, typescript } = {}) {
  const results = [];
  let misses = 0;
  let edits = 0;
  for (const file of files) {
    const result = transformSource(file.text, { app, relativePath: file.path, typescript });
    results.push({
      path: file.path,
      text: result.text,
      edits: result.edits.length,
      misses: result.misses,
    });
    misses += result.misses.length;
    edits += result.edits.length;
  }
  return { results, misses, edits };
}

/** True when the text has a host read through an explicit window cast, e.g. (window as T).x. */
export function hasWindowCastGlobalRead(text, globalName) {
  const castRead = new RegExp(
    '\\(\\s*window\\s*(?:!|as\\s+[^()]*|<[^<>]*>)\\s*\\)\\s*\\.\\s*' + escapeRegExp(globalName) + '\\b',
  );
  return castRead.test(text);
}

/**
 * Coarse text net, retained for diagnostics only: the authoritative survivor check
 * is emittedHostGlobalSurvivors, which reads the AST. This net reports a global that
 * appears in a comment or a string, and misses cast bracket and `!` forms.
 */
export function assertNoHostGlobals(text, { globalNames = HOST_GLOBAL_NAMES } = {}) {
  const survivors = [];
  for (const globalName of globalNames) {
    const dotRead = new RegExp('\\bwindow\\s*\\.\\s*' + escapeRegExp(globalName) + '\\b', 'g');
    let survivor = false;
    for (const match of text.matchAll(dotRead)) {
      // A "typeof window.x" type query is erased by the compiler, not a value read.
      if (/\btypeof\s*$/.test(text.slice(Math.max(0, match.index - 16), match.index))) continue;
      survivor = true;
      break;
    }
    if (survivor || hasWindowCastGlobalRead(text, globalName)) survivors.push(globalName);
  }
  return survivors;
}

/** Bracket access such as window["desktop"]; the transform refuses to leave it. */
export function assertNoBracketGlobals(text, { globalNames = HOST_GLOBAL_NAMES } = {}) {
  const survivors = [];
  const quoteClass = '[' + String.fromCharCode(34, 39, 96) + ']';
  for (const globalName of globalNames) {
    const pattern = new RegExp(
      '\\bwindow\\s*\\[\\s*' + quoteClass + escapeRegExp(globalName) + quoteClass + '\\s*\\]',
    );
    if (pattern.test(text)) survivors.push(globalName);
  }
  return survivors;
}
