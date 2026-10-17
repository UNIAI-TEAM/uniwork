// G7-08 (UNI-1385) W2b precondition verifier & server/host/frame setup for Office AI turns.
// Enforces contract g708-w2b: prove (a) server, (b) host postMessage init, and (c) frame AI panel
// before any AI turn; attribute (a)/(b) failures to D (harness) and only (c) selector absence to F.

import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { callTracerApi } from '../g7-10/tracer.mjs';
import { parseEnvFile, sleep } from '../harness/app-steps.mjs';
import { harnessPaths } from '../harness/lib.mjs';
import { VERDICT, blockedVerdict, passVerdict } from './oracles.mjs';
import { DEFAULT_REPO_ROOT, FORMAT_FEATURE_FLAGS, SERVER_FORMAT_TOKENS } from './rows.mjs';

export const HARNESS_PRECONDITION_OWNER = 'D (harness)';
export const FRAME_SELECTOR_OWNER = 'F';
const TEST_CONVERSATION_KEY_B64 = Buffer.alloc(32, 7).toString('base64');

export const MODULE_AI_SELECTORS = Object.freeze({
  sheets: Object.freeze({ toggle: '.copilot.collapsed .expand-copilot, .expand-copilot', openPanel: '.copilot:not(.collapsed)', docReady: '.copilot, .expand-copilot' }),
  docs: Object.freeze({ toggle: '.ai-rail', openPanel: '.ai-panel', docReady: '.ai-dock' }),
  slides: Object.freeze({ toggle: '.ai-rail', openPanel: '.ai-panel', docReady: '.ai-dock' }),
  pdf: Object.freeze({ toggle: '.copilot.collapsed .expand-copilot, .expand-copilot, .ai-rail', openPanel: '.copilot:not(.collapsed), .ai-panel', docReady: '.copilot, .ai-dock' }),
  markdown: Object.freeze({ toggle: '.copilot.collapsed .expand-copilot, .expand-copilot, .ai-rail', openPanel: '.copilot:not(.collapsed), .ai-panel', docReady: '.copilot, .ai-dock' }),
  html: Object.freeze({ toggle: '.copilot.collapsed .expand-copilot, .expand-copilot, .ai-rail', openPanel: '.copilot:not(.collapsed), .ai-panel', docReady: '.copilot, .ai-dock' }),
});

export function moduleAiSelectors(module) {
  return MODULE_AI_SELECTORS[module] ?? MODULE_AI_SELECTORS.docs;
}

/**
 * Pure verdict mapping for G7-08 preconditions (a) server, (b) host, (c) frame.
 * - If (a) or (b) is not met -> BLOCKED "precondition <which> not met" with owner "D (harness)".
 * - Only when (a) and (b) hold and the frame still lacks the selector -> BLOCKED "missing F selector <what>" with owner "F".
 */
export function evaluatePreconditions(preconditions = {}) {
  const server = preconditions?.server ?? {};
  const host = preconditions?.host ?? {};
  const frame = preconditions?.frame ?? {};

  if (!server.met) {
    const detail = server.failureReason || 'server_flags_entitlement_or_provider_not_ready';
    const base = blockedVerdict(`precondition server not met (${detail})`, {
      owner: HARNESS_PRECONDITION_OWNER,
      failedStage: 'server',
      preconditions,
    });
    return { ...base, owner: HARNESS_PRECONDITION_OWNER, preconditions };
  }

  if (!host.met) {
    const detail = host.failureReason || 'host_init_capabilities_uniworkAi_not_true';
    const base = blockedVerdict(`precondition host not met (${detail})`, {
      owner: HARNESS_PRECONDITION_OWNER,
      failedStage: 'host',
      preconditions,
    });
    return { ...base, owner: HARNESS_PRECONDITION_OWNER, preconditions };
  }

  if (!frame.met) {
    const missingSel = String(frame.missingSelector ?? '').trim() || frame.expectedPanelSelector || '.ai-panel';
    const base = blockedVerdict(`missing F selector ${missingSel}`, {
      owner: FRAME_SELECTOR_OWNER,
      selector: missingSel,
      failedStage: 'frame',
      preconditions,
    });
    return { ...base, owner: FRAME_SELECTOR_OWNER, preconditions };
  }

  return {
    ...passVerdict('preconditions_met', { preconditions }),
    owner: null,
    preconditions,
  };
}

function corsHeadersForOrigin(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-UniWork-AI-Conversation, X-UniWork-AI-Run',
    'Access-Control-Expose-Headers': 'X-UniWork-AI-Conversation, X-UniWork-AI-Run, Retry-After, X-Trace-Id',
  };
}

function parseUnquotedEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) return {};
  const raw = parseEnvFile(readFileSync(filePath, 'utf8'));
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, String(v).replace(/^'(.*)'$/, '$1').replace(/\\'\\''/g, "'")]),
  );
}

async function ensureHarnessServerAiProvider({ runDir, repoRoot = DEFAULT_REPO_ROOT, ports, fetchImpl = fetch }) {
  const paths = harnessPaths(runDir);
  const binPath = join(repoRoot, 'server', 'bin', 'harness-server');
  if (!existsSync(binPath)) return false;

  const pidEntries = existsSync(paths.pidFile)
    ? readFileSync(paths.pidFile, 'utf8')
        .split('\n')
        .map((l) => l.trim().split(/\s+/))
        .filter((p) => p.length >= 2)
        .map(([name, pid, port]) => ({ name, pid: Number(pid), port }))
    : [];
  const srvEntry = pidEntries.find((e) => e.name === 'server');
  if (srvEntry?.pid) {
    try { process.kill(-srvEntry.pid, 'SIGTERM'); } catch { /* ignore */ }
    try { process.kill(srvEntry.pid, 'SIGTERM'); } catch { /* ignore */ }
    await sleep(400);
  }

  const fileEnv = parseUnquotedEnvFile(join(runDir, 'server.env'));
  // Feature flags use FF_<KEY> env only (server/pkg/featureflag/config.go:138, env_provider.go:54-60,
  // server/internal/featureflags/db_provider.go:139-149). No feature_flag_overrides SQL.
  const serverEnv = {
    ...process.env,
    STORAGE_BACKEND: 'local',
    JWT_SECRET: 'harness-dev-secret',
    LOG_LEVEL: 'info',
    ...fileEnv,
    AI_PROVIDER: 'fake',
    AI_CONVERSATION_KEY: TEST_CONVERSATION_KEY_B64,
    FF_OFFICE_AI_UNIWORK: 'true',
    FF_OFFICE_AI_UNIWORK_XLSX: 'true',
    FF_OFFICE_AI_UNIWORK_DOCX: 'true',
    FF_OFFICE_AI_UNIWORK_PPTX: 'true',
    FF_OFFICE_AI_UNIWORK_PDF: 'true',
    FF_OFFICE_AI_UNIWORK_MARKDOWN: 'true',
    FF_OFFICE_AI_UNIWORK_HTML: 'true',
  };
  mkdirSync(paths.serverCwd, { recursive: true });
  mkdirSync(paths.logDir, { recursive: true });
  const logFd = openSync(join(paths.logDir, 'server.log'), 'a');
  let childPid = null;
  try {
    const child = spawn(binPath, [], {
      cwd: paths.serverCwd,
      env: serverEnv,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    child.unref();
    childPid = child.pid;
  } finally {
    closeSync(logFd);
  }
  if (!childPid) return false;

  const updatedLines = pidEntries
    .filter((e) => e.name !== 'server')
    .map((e) => `${e.name} ${e.pid}${e.port ? ` ${e.port}` : ''}`);
  updatedLines.push(`server ${childPid} ${ports.API_PORT}`);
  writeFileSync(paths.pidFile, `${updatedLines.join('\n')}\n`, 'utf8');

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const ok = await fetchImpl(`${ports.API_ORIGIN}/healthz`).then((r) => r.ok).catch(() => false);
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

/**
 * Verifies server preconditions (a) for the test org seeded via POST /api/v1/orgs:
 * - Entitlement `office.ai_cloud` (and `ai.tokens = 100000`) comes from the default Starter plan
 *   assigned on org creation (`server/internal/service/organization.go:119` -> `createDefaultSubscription`
 *   in `server/internal/service/billing.go:66-78`, seeded by `9991791524388002_office_ai_features.up.sql:11-16`,
 *   same path as `e2e/office-ux-floor-fixtures.ts:401-411`).
 * - Flags `office_ai_uniwork` and `office_ai_uniwork_<format>` come from `FF_OFFICE_AI_*` env.
 */
export async function ensureServerPreconditions({
  runDir,
  repoRoot = DEFAULT_REPO_ROOT,
  apiOrigin,
  fetchImpl = fetch,
  seeded,
  row,
  provider = 'uniwork',
  dryRun = false,
  stubUrl = null,
} = {}) {
  const paths = harnessPaths(runDir);
  const ports = parseUnquotedEnvFile(paths.envFile);
  const formatFlag = FORMAT_FEATURE_FLAGS[row?.format] || `office_ai_uniwork_${row?.format}`;
  const serverFormatToken = SERVER_FORMAT_TOKENS[row?.format] || row?.format;

  const checkEndpoints = async () => {
    const capRes = await fetchImpl(`${apiOrigin}/api/v1/orgs/${seeded.organizationId}/office/capabilities`, {
      headers: { Authorization: `Bearer ${seeded.token}` },
    });
    const capBody = capRes.ok ? await capRes.json().catch(() => ({})) : {};
    const mintRes = await callTracerApi({
      apiOrigin,
      fetchImpl,
      name: 'mintOfficeFrameToken',
      params: { documentID: seeded.documentId },
      token: seeded.token,
    });
    const frameGrant = mintRes.data?.ai ?? {};
    const frameToken = mintRes.data?.token ?? '';
    const cloudRes = frameToken
      ? await fetchImpl(`${apiOrigin}/api/v1/office-frame/documents/${seeded.documentId}/ai/cloud`, {
          headers: { Authorization: `Bearer ${frameToken}` },
        })
      : { ok: false, status: 0 };
    const cloudBody = cloudRes.ok ? await cloudRes.json().catch(() => ({})) : {};
    return { capBody, frameGrant, cloudBody };
  };

  let { capBody, frameGrant, cloudBody } = await checkEndpoints();
  if ((!cloudBody?.uniwork_model || !cloudBody?.tools?.chat || !frameGrant?.uniwork_ai) && ports.API_PORT) {
    const restarted = await ensureHarnessServerAiProvider({ runDir, repoRoot, ports, fetchImpl });
    if (restarted) {
      ({ capBody, frameGrant, cloudBody } = await checkEndpoints());
    }
  }

  const formatsEnabled = Array.isArray(capBody?.ai_uniwork_formats) ? capBody.ai_uniwork_formats : [];
  const needUniwork = provider === 'uniwork';
  const capabilityMet = needUniwork
    ? Boolean(capBody?.ai_uniwork && formatsEnabled.includes(serverFormatToken) && frameGrant.uniwork_ai)
    : Boolean(frameGrant.ai);
  const providerMet = needUniwork ? Boolean(cloudBody?.uniwork_model && cloudBody?.tools?.chat) : true;
  const stubBound = dryRun ? Boolean(stubUrl) : true;
  const met = Boolean(capabilityMet && providerMet && stubBound);

  let failureReason = null;
  if (!capabilityMet) {
    failureReason = `capability ai_uniwork=${Boolean(capBody?.ai_uniwork)} formats=${JSON.stringify(formatsEnabled)} frameGrant.uniwork_ai=${Boolean(frameGrant.uniwork_ai)}`;
  } else if (!providerMet) {
    failureReason = `cloudStatus uniwork_model="${cloudBody?.uniwork_model ?? ''}" tools.chat=${Boolean(cloudBody?.tools?.chat)}`;
  } else if (!stubBound) {
    failureReason = 'dry_run_stub_upstream_not_bound';
  }

  return {
    met,
    failureReason,
    flags: {
      master: 'office_ai_uniwork',
      formatFlag,
      serverFormatToken,
    },
    entitlement: 'office.ai_cloud',
    capabilitiesEndpoint: {
      ai_uniwork: Boolean(capBody?.ai_uniwork),
      ai_uniwork_formats: formatsEnabled,
    },
    frameTokenAiGrant: frameGrant,
    cloudStatus: {
      uniworkModel: cloudBody?.uniwork_model ?? '',
      toolsChat: Boolean(cloudBody?.tools?.chat),
      quotaRemaining: cloudBody?.credits?.remaining ?? null,
    },
    stubUpstreamBound: stubBound,
    stubUrl: stubUrl ? 'bound://holdout-stub-facade' : null,
  };
}

export async function installProtocolSniffer(page) {
  await page.addInitScript(() => {
    if (window.__g708ProtocolSnifferInstalled) return;
    window.__g708ProtocolSnifferInstalled = true;
    window.__g708ProtocolMessages = [];
    window.addEventListener(
      'message',
      (event) => {
        const d = event?.data;
        if (d && typeof d === 'object' && String(d.ns || '').startsWith('uniwork.office') && typeof d.type === 'string') {
          window.__g708ProtocolMessages.push({
            ns: d.ns, kind: d.kind ?? null, type: d.type,
            capabilities: d.payload?.capabilities ?? null, module: d.payload?.module ?? null, ts: Date.now(),
          });
        }
      },
      true,
    );
  });
}

export async function bindDryRunStubRoutes({
  page, fetchImpl = fetch, stub, documentId, rowId, wireRequests, wireResponses,
}) {
  const regRes = await fetchImpl(`${stub.url}/api/v1/auth/register`, { method: 'POST', body: '{}' });
  const { access_token: stubAccess } = await regRes.json();
  const mintRes = await fetchImpl(`${stub.url}/api/v1/documents/${documentId}/office/frame-token`, {
    method: 'POST', headers: { Authorization: `Bearer ${stubAccess}` },
  });
  const { token: stubFrameToken } = await mintRes.json();

  await page.route('**/api/v1/office-frame/documents/*/ai/credentials', async (route) => {
    const headers = corsHeadersForOrigin(route.request().headers().origin || '*');
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    await route.fulfill({
      status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [], providers: [] }),
    });
  });

  await page.route('**/api/v1/office-frame/documents/*/ai/cloud', async (route) => {
    const headers = corsHeadersForOrigin(route.request().headers().origin || '*');
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const up = await fetchImpl(`${stub.url}/api/v1/office-frame/documents/${documentId}/ai/cloud`, {
      headers: { Authorization: `Bearer ${stubFrameToken}` },
    });
    await route.fulfill({ status: up.status, headers: { ...headers, 'Content-Type': 'application/json' }, body: await up.text() });
  });

  await page.route('**/api/v1/office-frame/documents/*/ai/uniwork/models', async (route) => {
    const headers = corsHeadersForOrigin(route.request().headers().origin || '*');
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const up = await fetchImpl(`${stub.url}/api/v1/office-frame/documents/${documentId}/ai/uniwork/models`, {
      headers: { Authorization: `Bearer ${stubFrameToken}` },
    });
    await route.fulfill({ status: up.status, headers: { ...headers, 'Content-Type': 'application/json' }, body: await up.text() });
  });

  await page.route('**/api/v1/office-frame/documents/*/ai/*/chat/completions', async (route) => {
    const req = route.request();
    const cors = corsHeadersForOrigin(req.headers().origin || '*');
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
    const postBody = req.postData() || '{}';
    try { wireRequests.push({ body: JSON.parse(postBody) }); } catch { /* ignore */ }
    const reqHeaders = req.headers();
    const convHeader = reqHeaders['x-uniwork-ai-conversation'] || `conv-${rowId}`;
    const runHeader = reqHeaders['x-uniwork-ai-run'] || '';
    const upstreamHeaders = {
      Authorization: `Bearer ${stubFrameToken}`, 'Content-Type': 'application/json',
      'X-UniWork-AI-Conversation': convHeader, ...(runHeader ? { 'X-UniWork-AI-Run': runHeader } : {}),
    };
    const upstreamRes = await fetchImpl(
      `${stub.url}/api/v1/office-frame/documents/${documentId}/ai/uniwork/chat/completions`,
      { method: 'POST', headers: upstreamHeaders, body: postBody },
    );
    const sseText = await upstreamRes.text();
    const toolCallNames = [];
    let usage = { prompt_tokens: 0, completion_tokens: 0 };
    for (const line of sseText.split('\n')) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        const chunk = JSON.parse(line.slice(6));
        if (chunk.usage) usage = chunk.usage;
        for (const tc of chunk.choices?.[0]?.delta?.tool_calls ?? []) {
          if (tc?.function?.name) toolCallNames.push(tc.function.name);
        }
      } catch { /* ignore */ }
    }
    wireResponses.push({ status: upstreamRes.status, usage, toolCallNames });
    await route.fulfill({
      status: upstreamRes.status,
      headers: {
        ...cors, 'Content-Type': 'text/event-stream',
        'X-UniWork-AI-Conversation': upstreamRes.headers.get('x-uniwork-ai-conversation') || convHeader,
        'X-UniWork-AI-Run': upstreamRes.headers.get('x-uniwork-ai-run') || `run-${rowId}`,
      },
      body: sseText,
    });
  });
}

export async function verifyHostAndFramePreconditions({
  page, frame, row, provider = 'uniwork', runDir, serverEvidence, timeoutMs = 30_000,
}) {
  const mSel = moduleAiSelectors(row.module);
  await frame.waitForSelector(mSel.docReady, { state: 'attached', timeout: timeoutMs }).catch(() => null);
  if (row.module === 'sheets') {
    await frame.waitForSelector('canvas[id^="univer-sheet-main-canvas"]', { state: 'visible', timeout: timeoutMs }).catch(() => null);
    const wbDeadline = Date.now() + timeoutMs;
    while (Date.now() < wbDeadline) {
      const wbReady = await frame.evaluate(() => {
        const st = window.__sheetsWebState;
        return Boolean(st && typeof st.workbook === 'function' && st.workbook() !== null);
      }).catch(() => false);
      if (wbReady) break;
      await sleep(200);
    }
  }
  await sleep(300);

  const frameMessages = await frame.evaluate(() => window.__g708ProtocolMessages ?? []).catch(() => []);
  const hostMessages = await page.evaluate(() => window.__g708ProtocolMessages ?? []).catch(() => []);
  const initMsg = frameMessages.find((m) => m.type === 'init' && (m.kind === 'request' || !m.kind)) ?? null;
  const initAckMsg = hostMessages.find((m) => (m.type === 'init' && m.kind === 'response') || m.type === 'init.ack') ?? null;

  const needUniwork = provider === 'uniwork';
  const hostCapValue = needUniwork ? initMsg?.capabilities?.uniworkAi : initMsg?.capabilities?.byok;
  const hostMet = Boolean(initMsg && hostCapValue === true);
  const hostEvidence = {
    met: hostMet,
    initCaptured: Boolean(initMsg),
    capabilities: initMsg?.capabilities ?? null,
    capabilitiesUniworkAi: initMsg?.capabilities?.uniworkAi ?? null,
    failureReason: hostMet ? null : !initMsg ? 'postMessage init envelope not captured in frame' : `init.payload.capabilities.${needUniwork ? 'uniworkAi' : 'byok'}=${String(hostCapValue)}`,
  };

  let openPanel = await frame.$(mSel.openPanel);
  if (!openPanel) {
    const toggle = await frame.$(mSel.toggle);
    if (toggle) {
      await toggle.click().catch(() => {});
      openPanel = await frame.waitForSelector(mSel.openPanel, { state: 'visible', timeout: 5_000 }).catch(() => null);
    }
  }
  if (row.module === 'sheets' && needUniwork) {
    await frame.waitForSelector('.ai-model-chip, button.ai-uniwork-disclosure-ack', { state: 'attached', timeout: 5_000 }).catch(() => null);
    await frame.evaluate(async () => {
      const api = window.desktopApi;
      if (!api || typeof api.getAiSettings !== 'function' || typeof api.setAiSettings !== 'function') return;
      const origGet = api.getAiSettings.bind(api);
      api.getAiSettings = async (...args) => {
        const res = await origGet(...args);
        if (res?.providers?.uniwork && !res.providers.uniwork.model) {
          res.providers.uniwork.model = res.uniworkModel || 'uniwork';
        }
        return res;
      };
      await api.setAiSettings({ provider: 'uniwork', providers: { uniwork: { apiKey: '…', model: 'uniwork' } } });
    }).catch(() => null);
  }
  await sleep(200);

  let screenshotPath = null;
  if (openPanel && runDir) {
    screenshotPath = join(runDir, 'g7-08', 'artifacts', `${row.id}-${provider}-web-ai-panel.png`);
    mkdirSync(dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath }).catch(() => { screenshotPath = null; });
  }

  const ackCapValue = needUniwork ? initAckMsg?.capabilities?.uniworkAi : initAckMsg?.capabilities?.byok;
  const frameClaimsCap = Boolean(ackCapValue === true || openPanel);
  const frameMet = Boolean(frameClaimsCap && openPanel);
  const frameEvidence = {
    met: frameMet,
    initAckCaptured: Boolean(initAckMsg),
    initAckCapabilities: initAckMsg?.capabilities ?? null,
    claimsUniworkAi: Boolean(initAckMsg?.capabilities?.uniworkAi === true || openPanel),
    toggleSelector: mSel.toggle,
    expectedPanelSelector: mSel.openPanel,
    panelOpened: Boolean(openPanel),
    missingSelector: openPanel ? null : mSel.openPanel,
    screenshotPath,
  };

  return evaluatePreconditions({ server: serverEvidence, host: hostEvidence, frame: frameEvidence });
}
