import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { transform } from "esbuild";

const base = (process.env.SEO_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const source = await readFile(new URL("../packages/core/paths/marketing.ts", import.meta.url), "utf8");
const result = await transform(source, { loader: "ts", format: "esm" });
const { MARKETING_ROUTES, marketingHref } = await import(`data:text/javascript;base64,${Buffer.from(result.code).toString("base64")}`);
async function request(path, userAgent = "Googlebot") {
  const response = await fetch(base + path, { headers: { "User-Agent": userAgent, cookie: "uniwork-locale=en" }, signal: AbortSignal.timeout(30000) });
  return { response, text: await response.text() };
}
// Native HTTP preserves a custom Host; Node fetch may replace it with the URL host.
function localHostRequest(host) {
  return new Promise((resolve, reject) => {
    const send = base.startsWith("https:") ? httpsRequest : httpRequest;
    const call = send(new URL("/office", base), { headers: { Host: host }, timeout: 30000 }, response => {
      response.resume();
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers }));
      response.on("error", reject);
    });
    call.on("error", reject);
    call.on("timeout", () => call.destroy(new Error("SEO Host probe timed out")));
    call.end();
  });
}
const routes = MARKETING_ROUTES.flatMap(route => ["en", "vi"].map(locale => ({ path: marketingHref(route.path, locale), locale })));
const summaries = [];
let cursor = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < routes.length) {
    const { path, locale } = routes[cursor++];
    const { response, text } = await request(path);
    assert.equal(response.status, 200, path);
    assert.match(text, new RegExp(`<html[^>]*lang="${locale}"`), path + " HTML locale");
    const canonical = text.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1];
    assert.ok(canonical, path + " canonical");
    assert.equal(new URL(canonical).pathname, path, path + " self canonical");
    for (const language of ["en", "vi", "x-default"]) assert.match(text, new RegExp(`hrefLang="${language}"|hreflang="${language}"`), path + " language alternate");
    const body = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    assert.equal((body.match(/<h1\b/g) ?? []).length, 1, path + " H1");
    assert.match(text, /<title>[^<]+<\/title>/, path + " title");
    assert.match(text, /<meta[^>]*name="description"[^>]*content="[^"]+"/, path + " description");
    const graphText = text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(graphText, path + " structured data");
    const graph = JSON.parse(graphText);
    assert.ok(graph["@graph"].some(node => node["@type"] === "BreadcrumbList"));
    assert.ok(!/landing\.(studio|productPages|office)\.|marketingSeo\.|office\.desktop\.install\./.test(body), path + " translated content");
    summaries.push({ path, locale, bytes: Buffer.byteLength(text), canonical });
  }
}));
const robots = await request("/robots.txt");
assert.equal(robots.response.status, 200);
const sitemap = await request("/sitemap.xml");
assert.equal(sitemap.response.status, 200);
if (/Disallow: \/\s*(?:\n|$)/.test(robots.text)) {
  assert.equal((sitemap.text.match(/<loc>/g) ?? []).length, 0, "preview sitemap");
  assert.match((await request("/")).response.headers.get("x-robots-tag") ?? "", /noindex/);
} else {
  assert.equal((sitemap.text.match(/<loc>/g) ?? []).length, routes.length);
  assert.ok(!/<loc>[^<]*(?:\/admin|\/login|\/share\/|\/invite\/|\/workspaces)/.test(sitemap.text));
  if (["localhost", "127.0.0.1"].includes(new URL(base).hostname)) {
    const publicHost = await localHostRequest("uniworkos.com");
    assert.equal(publicHost.headers["x-robots-tag"] ?? null, null, "self-hosted public Host must remain indexable");
    const alias = await localHostRequest("www.uniworkos.com");
    assert.equal(alias.status, 308);
    assert.equal(alias.headers.location, "https://uniworkos.com/office");
  }
}
for (const path of ["/admin", "/workspaces", "/login", "/audit-org/audit-workspace/tasks"]) assert.match((await request(path)).response.headers.get("x-robots-tag") ?? "", /noindex/, path);
for (const path of ["/features/not-a-feature", "/vi/not-a-public-page"]) assert.equal((await request(path)).response.status, 404, path);
const crawlerChecks = [];
for (const userAgent of ["Googlebot", "bingbot", "OAI-SearchBot", "PerplexityBot"]) {
  for (const path of ["/learn/office-files-and-ai", "/vi/learn/office-files-and-ai", "/security", "/vi/security"]) {
    const { response, text } = await request(path, userAgent);
    assert.equal(response.status, 200, `${userAgent} ${path}`);
    const html = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    assert.match(html, /<h1\b/, `${userAgent} readable HTML`);
    assert.match(html, /UniWork/, `${userAgent} product identity`);
    if (path.includes("office-files")) assert.match(html, /\.xlsx/, `${userAgent} source-backed formats table`);
    crawlerChecks.push({ userAgent, path, status: response.status });
  }
}
console.log(JSON.stringify({ checked: summaries.length, publicPages: summaries, privateRoutes: "noindex", invalidRoutes: "404", sitemap: "valid", crawlerChecks, crawlerCheckScope: "HTTP User-Agent simulation; does not verify real crawler IP access at the CDN/WAF" }, null, 2));
