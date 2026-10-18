# Public search and multilingual pages

## URL and indexing contract

English keeps the existing public URLs. Vietnamese uses `/vi` and the same
relative path, for example `/apps/office` and `/vi/apps/office`. The URL determines public
copy even when a language cookie has another value. Language links navigate to
the corresponding URL; application pages retain their existing cookie preference.

`packages/core/paths/marketing.ts` is the finite public URL catalog. Only those
pages receive indexable metadata. It drives sitemap entries, hreflang, public
navigation and proxy classification. New pages need a catalog entry, bilingual
copy and an explicit route builder. Feature and guide parameters are finite;
unknown entries return 404.

Each public URL has a self canonical, reciprocal `en`, `vi` and `x-default`
alternates, title, description, social metadata and one H1. Canonicals omit
tracking parameters. The default English URL is `x-default`; there is no forced
language redirect based on IP or cookies.

The root metadata defaults to `noindex, nofollow`. The search proxy adds that
HTTP header to private, utility and unknown routes, and to requests on hosts
other than `uniworkos.com`. Public pages override the root metadata. Keep the
private response header: robots.txt blocking is not a substitute for noindex,
authentication or authorization. Office frame responses are also noindex.

`NEXT_PUBLIC_APP_URL` must be exactly `https://uniworkos.com` for production.
Other configured origins get a disallow-all robots policy and an empty sitemap.
Production robots allows crawling so Google can observe private route noindex.
The sitemap contains only catalogued canonical public URLs, in both languages.
It omits `lastmod` until accurate per-page editorial dates are available.

The current 70 entries are 35 public marketing/guide pages in two languages,
not every application screen. For example `/features/tasks` explains task
management; `/{orgSlug}/{workspaceSlug}/tasks` is authenticated application
content and never belongs in this sitemap. Login, registration, onboarding,
admin, workspace, invitation, shared-token and API routes are excluded. Sitemap
URLs come from the explicit catalog rather than a filesystem or database scan.
Titles, descriptions, Open Graph, Twitter cards and JSON-LD belong in each
page's HTML, not inside sitemap XML. A browser's flattened presentation of XML
does not establish whether Google can parse it; inspect its XML response and
Search Console's sitemap result.

The proxy redirects `www.uniworkos.com` to the canonical origin. DNS and TLS for
www must be configured separately before that redirect can receive traffic.
Verify host forwarding at the deployed edge: the application must see the public
host, not an internal service hostname.

## Rendering and loading

Public copy is rendered in the initial HTML. A request-scoped i18n instance gets
only marketing and necessary preview labels. The application providers, full
application translations, Office draft registration and push setup load on
application routes. Auth links use a document navigation and preserve language.
Marketing links disable speculative prefetch by default. Fonts no longer preload
every app family on public pages. Office screenshots load lazily.

The authenticated and marketing surfaces still share the root layout. It reads
request headers and cookies; public HTML remains dynamically rendered with the
existing private caching policy. Do not add shared CDN HTML caching without
first separating that authenticated root and verifying locale/session isolation.
Request dictionary caching uses React.cache; it is not cross-user HTML caching.

## Content and structured data

Three bilingual guides cover task setup, Office files and AI, and meeting
decisions becoming tasks. About and Data & AI pages describe known product
behavior, limits, connectivity and access controls. They are not legal policies.

Structured data describes Organization, WebSite, WebPage and breadcrumbs.
Office also has a descriptive SoftwareApplication node. There are no invented
prices, offers, ratings, reviews or certifications. SoftwareApplication markup
alone does not establish eligibility for a Google rich result. FAQ rich result
markup and `llms.txt` are not part of this implementation.

`apps/web/platform/site-information.ts` holds optional owner-confirmed values:
legal name, support email, approved privacy/terms URLs and a Google site
verification token. They intentionally start empty. Footer links and verification
metadata appear only when configured. Publish approved legal documents before
adding their URLs; do not present the Data & AI explanation as a privacy policy.

## Verification and release

Run the app production build, start it, then run `pnpm seo:check` from the root.
Set `SEO_BASE_URL` to check another deployment. The read-only smoke test checks
all 70 public URLs, language, canonicals, alternates, H1, translations, JSON-LD,
robots/sitemap, private-route noindex and invalid-route 404. CI runs it after the
web and backend readiness checks. `e2e/seo.spec.ts` covers language switching,
no-JavaScript reading, mobile overflow and both themes. Unit tests cover the URL
catalog, metadata, dictionary selection and trusted locale proxy headers.

Before release:

1. Check existing organization/workspace slugs for collisions with the new
   reserved global prefixes `vi`, `about`, `security`. Reserved-slug generation
   prevents new collisions; it does not rename existing organizations.
2. Build with the correct origin. Check `/robots.txt`, `/sitemap.xml`, both Office
   URLs, private noindex and the actual forwarded public host after deployment.
3. Submit the sitemap through an owner-verified Search Console property. Use URL
   Inspection for representative English/Vietnamese pages and monitor indexing.
4. Verify www DNS/TLS and its single-hop canonical redirect if www is supported.
5. Review field RUM/Search Console Core Web Vitals over a representative period.
   Local resource counts are not field CWV or evidence of ranking improvement.
6. Fill the confirmed company/policy configuration when the owner supplies it.

Google sources reviewed for this work: [multilingual sites](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites),
[noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing),
[structured-data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies),
[AI optimization](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide),
[Search status](https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history).
Algorithm changes do not provide a ranking guarantee; the implementation focuses
on crawlability, useful product information and measurable loading behavior.

## Implementation measurements (15 October 2026)

The reference is the anonymous deployed site from the audit; the updated result
is a local production build. These are not a controlled comparison of the same
deployment infrastructure or bundler, and do not measure field CWV.

| Observation | Audit reference | Updated local production |
| --- | ---: | ---: |
| Office Vietnamese HTML, decoded | ~628 kB | ~166 kB |
| Office English HTML, decoded | ~109 kB | ~156 kB |
| Home JavaScript, decoded | ~2.17 MB | ~1.59 MB |
| Home cold font requests | 18 | 6 |

English Office HTML increases because its selected copy now travels in the RSC
payload rather than relying on the complete English application dictionary in
the client bundle. Vietnamese avoids serializing the full application dictionary.
Both languages still need further route-level JavaScript splitting if a tighter
budget is required. Keep the existing private HTML cache policy until the
authenticated root is isolated. The dark Office screenshot was the only Office
image fetched on the sampled dark first view; no hidden light screenshot loaded.

Build and focused unit/browser checks are necessary release evidence, not a
guarantee of indexing or search rankings. `make check` could not run on the
implementation machine because GNU Make was unavailable; the directly executed
frontend checks are recorded in the implementation handoff.

Implementation handoff: production webpack build passed; 43 focused unit tests
passed across core paths/i18n and web SEO/locale/Office; 18 public E2E tests
passed, with the four SEO flows passing a second confirmation run. The final
HTTP smoke passed all 70 public URLs, private noindex, true 404 and the real
self-hosted production Host/www redirect probes. Scoped ESLint, CI YAML parsing
and `git diff --check` passed. Backend and the complete repository gate were not
run as part of this frontend verification.

## Product evidence and legal follow-up for AEO and GEO

The five existing bilingual reading pages now give direct product answers rather
than introducing extra thin query-variant pages. The Office format table reads
the actual web host capability contract, including the 10 MiB XLSX cap, permitted
exports and the six supported web editor groups. It does not promise full file
fidelity or desktop format support. A real existing localized Office capture is
included with light/dark variants and a sample-data caption.

Meeting guidance describes the implemented host/admin action-item selection and
task-creation flow. Task guidance includes a clearly labelled teaching example.
About distinguishes published examples, roadmap status and actual evaluation.
Data & AI distinguishes access revocation from deletion and states that web BYOK
requests pass through UniWork. The older blanket claim that personal API keys
always bypass UniWork has also been corrected on the Office page. The footer
uses the UniWork brand while legal operator identity awaits confirmation.

`docs/seo-legal-request.json` records code evidence, limits, 20 stable legal
request IDs (PC01-PC20), four operational follow-ups (OP01-OP04), response fields
and the mapping to optional site-information configuration. The exported PDF and
text response template are intended for the company's legal team. They are a
request for information and approval, not published policies. No jurisdiction,
legal operator, retention period, AI training promise, SLA or certification is
inferred from repository code.

The HTTP smoke additionally simulates Googlebot, bingbot, OAI-SearchBot and
PerplexityBot on four representative English/Vietnamese pages. This verifies
readable server HTML at the application boundary. It does not verify actual
crawler IP access through a production CDN/WAF, indexing or AI citations.
Search crawling and foundation-model training are separate policy decisions;
robot training preferences remain an explicit legal/content-owner follow-up.

When the company returns information, reconcile it by request ID and scope.
Publish only approved public text and URLs; keep confidential contracts and
credentials out of public content and the repository. Recheck product and
deployment evidence before changing public statements.

Verification for this content extension: production build, scoped ESLint and
TypeScript passed; 46 focused unit tests and five SEO browser tests passed.
The mobile Office table/image flow passed a confirmation run after fixing a
wrapped editor name. All 70 public URLs and 16 representative search User-Agent
probes passed the HTTP smoke. The seven-page legal PDF was rendered and every
page inspected; all 20 legal and four operational IDs are present in its response
template. The full `make check` gate remains unavailable on this Windows host
because Make is not installed.
