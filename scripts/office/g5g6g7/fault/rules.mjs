// Rule engine for the G7-03a fault-injection proxy (UNI-1380).
//
// Rules are evaluated in declaration order; the first matching armed rule wins.
// `nth` (1-based) counts requests whose method and path matched the rule and
// fires only on that ordinal; `once` disarms the rule immediately on its first
// hit so concurrent follow-up requests pass through.

export const ACTION_TYPES = new Set([
  "delay",
  "drop_request",
  "drop_response_after_forward",
  "status",
  "reset",
  "hold",
]);

/**
 * Returns the URL pathname with query string and fragment stripped, without
 * touching or logging query parameters (which may carry signed tokens/tickets).
 */
export function stripQuery(rawUrl = "") {
  const input = String(rawUrl || "/");
  const qIndex = input.indexOf("?");
  const hIndex = input.indexOf("#");
  const cutAt =
    qIndex >= 0 && hIndex >= 0 ? Math.min(qIndex, hIndex) : qIndex >= 0 ? qIndex : hIndex;
  const withoutQuery = cutAt >= 0 ? input.slice(0, cutAt) : input;
  if (/^https?:\/\//i.test(withoutQuery)) {
    try {
      return new URL(withoutQuery).pathname || "/";
    } catch {
      return withoutQuery || "/";
    }
  }
  return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
}

/**
 * Validates and normalizes one fault rule definition.
 */
export function validateRule(rawRule, index = 0) {
  if (!rawRule || typeof rawRule !== "object" || Array.isArray(rawRule)) {
    throw new Error(`rule[${index}] must be an object`);
  }
  const id = typeof rawRule.id === "string" ? rawRule.id.trim() : "";
  if (!id) {
    throw new Error(`rule[${index}].id must be a non-empty string`);
  }
  const match = rawRule.match;
  if (!match || typeof match !== "object" || Array.isArray(match)) {
    throw new Error(`rule[${index}] (${id}): match must be an object`);
  }
  if (typeof match.path !== "string" || match.path.length === 0) {
    throw new Error(`rule[${index}] (${id}): match.path must be a non-empty regex string`);
  }
  let pathRegex;
  try {
    pathRegex = new RegExp(match.path);
  } catch (error) {
    throw new Error(`rule[${index}] (${id}): invalid match.path regex: ${error.message}`);
  }
  let method;
  if (match.method !== undefined && match.method !== null && match.method !== "") {
    if (typeof match.method !== "string") {
      throw new Error(`rule[${index}] (${id}): match.method must be a string`);
    }
    method = match.method.trim().toUpperCase();
  }
  let nth;
  if (match.nth !== undefined && match.nth !== null) {
    if (!Number.isInteger(match.nth) || match.nth < 1) {
      throw new Error(`rule[${index}] (${id}): match.nth must be a positive integer (1-based)`);
    }
    nth = match.nth;
  }

  const action = rawRule.action;
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new Error(`rule[${index}] (${id}): action must be an object`);
  }
  if (!ACTION_TYPES.has(action.type)) {
    throw new Error(`rule[${index}] (${id}): unsupported action.type ${String(action.type)}`);
  }

  const normalizedAction = { type: action.type };
  if (action.type === "delay") {
    if (typeof action.ms !== "number" || !Number.isFinite(action.ms) || action.ms < 0) {
      throw new Error(`rule[${index}] (${id}): delay action requires a non-negative ms number`);
    }
    normalizedAction.ms = action.ms;
  } else if (action.type === "status") {
    if (!Number.isInteger(action.code) || action.code < 100 || action.code > 599) {
      throw new Error(`rule[${index}] (${id}): status action requires an integer HTTP code (100..599)`);
    }
    normalizedAction.code = action.code;
    if (action.body !== undefined) {
      normalizedAction.body = action.body;
    }
  } else if (action.type === "hold") {
    const until = action.until ?? "release";
    if (until !== "release") {
      throw new Error(`rule[${index}] (${id}): hold action requires until="release"`);
    }
    normalizedAction.until = "release";
  }

  const once = rawRule.once === undefined ? false : Boolean(rawRule.once);
  if (rawRule.once !== undefined && typeof rawRule.once !== "boolean") {
    throw new Error(`rule[${index}] (${id}): once must be a boolean`);
  }

  return {
    id,
    match: {
      ...(method ? { method } : {}),
      path: match.path,
      ...(nth !== undefined ? { nth } : {}),
    },
    pathRegex,
    action: normalizedAction,
    once,
  };
}

/**
 * Validates a list of rules (or `{ rules: [...] }` envelope) and checks unique ids.
 */
export function validateRules(rulesInput) {
  const list =
    rulesInput && typeof rulesInput === "object" && !Array.isArray(rulesInput) && Array.isArray(rulesInput.rules)
      ? rulesInput.rules
      : rulesInput;
  if (!Array.isArray(list)) {
    throw new Error("rules must be a JSON array");
  }
  const seenIds = new Set();
  return list.map((item, index) => {
    const validated = validateRule(item, index);
    if (seenIds.has(validated.id)) {
      throw new Error(`duplicate rule id "${validated.id}" at index ${index}`);
    }
    seenIds.add(validated.id);
    return validated;
  });
}

/**
 * Creates a stateful rule engine instance.
 */
export function createRuleEngine(initialRules = []) {
  let entries = [];
  const holdWaiters = new Map();
  const preReleasedCounts = new Map();

  function releaseAllHolds() {
    for (const waiters of holdWaiters.values()) {
      for (const resolve of waiters) {
        resolve();
      }
    }
    holdWaiters.clear();
    preReleasedCounts.clear();
  }

  function setRules(rulesInput) {
    const validated = validateRules(rulesInput);
    releaseAllHolds();
    entries = validated.map((rule) => ({
      ...rule,
      matches: 0,
      hits: 0,
      armed: true,
    }));
    return getRules();
  }

  function clearRules() {
    releaseAllHolds();
    entries = [];
    return [];
  }

  function getRules() {
    return entries.map((entry) => ({
      id: entry.id,
      match: { ...entry.match },
      action: { ...entry.action },
      ...(entry.once ? { once: true } : {}),
      matches: entry.matches,
      hits: entry.hits,
      armed: entry.armed,
      held: holdWaiters.get(entry.id)?.size ?? 0,
    }));
  }

  function createHoldGate(ruleId) {
    const preReleased = preReleasedCounts.get(ruleId) ?? 0;
    if (preReleased > 0) {
      if (preReleased === 1) preReleasedCounts.delete(ruleId);
      else preReleasedCounts.set(ruleId, preReleased - 1);
      return Promise.resolve();
    }
    let waiters = holdWaiters.get(ruleId);
    if (!waiters) {
      waiters = new Set();
      holdWaiters.set(ruleId, waiters);
    }
    return new Promise((resolve) => {
      const done = () => {
        waiters.delete(done);
        if (waiters.size === 0) holdWaiters.delete(ruleId);
        resolve();
      };
      waiters.add(done);
    });
  }

  function release(ruleId) {
    const id = String(ruleId ?? "").trim();
    const waiters = holdWaiters.get(id);
    const count = waiters ? waiters.size : 0;
    if (waiters && count > 0) {
      for (const resolve of [...waiters]) {
        resolve();
      }
      holdWaiters.delete(id);
      return { ruleId: id, released: count };
    }
    const hasHoldRule = entries.some((entry) => entry.id === id && entry.action.type === "hold");
    if (hasHoldRule) {
      preReleasedCounts.set(id, (preReleasedCounts.get(id) ?? 0) + 1);
    }
    return { ruleId: id, released: 0 };
  }

  function matchRequest({ method = "GET", path = "/" } = {}) {
    const normalizedMethod = String(method || "GET").toUpperCase();
    const cleanPath = stripQuery(path);

    for (const entry of entries) {
      if (!entry.armed) continue;
      if (entry.match.method && entry.match.method !== normalizedMethod) continue;
      if (!entry.pathRegex.test(cleanPath)) continue;

      entry.matches += 1;
      if (entry.match.nth !== undefined && entry.matches !== entry.match.nth) {
        continue;
      }

      entry.hits += 1;
      if (entry.once) {
        entry.armed = false;
      }

      const waitForRelease = entry.action.type === "hold" ? createHoldGate(entry.id) : null;
      return {
        ruleId: entry.id,
        action: { ...entry.action },
        waitForRelease,
      };
    }

    return null;
  }

  if (initialRules.length > 0) {
    setRules(initialRules);
  }

  return {
    setRules,
    clearRules,
    getRules,
    matchRequest,
    release,
  };
}
