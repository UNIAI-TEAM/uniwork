# Why UniWork comparison chapter

The existing `/why-uniwork` page presents one connected project, a comparison
using shared criteria, three workflow examples and an invitation to evaluate with
the team's own work. It extends the public-marketing **Bright Studio** world:
Be Vietnam Pro, shared semantic colors, scarce cobalt actions, the official
UniWork identity and authored sample interfaces. The page introduces no new
global palette, typography, radius or spacing tokens.

## Implementation and boundaries

- `apps/web/features/landing/why-page.tsx` owns composition, comparison state,
  source links and route actions; `why-page.css` owns its local geometry.
- `platforms.ts` fixes the choice order: Microsoft 365, Notion, ClickUp, Coda.
- `FeatureIllustration` supplies the existing task, conversation, cited-answer
  and output-version scenes. These are authored illustrative content, with
  visible sample-data captions, not screenshots or live application controls.
- `MarketingShell` supplies the existing header, footer, skip link, single
  `main`, landing font and centered chapter invitation. This page passes its
  translated closing heading and `/features/tasks` destination into that
  invitation. The shared Final CTA implementation is inherited.
- `packages/core/i18n/locales/vi.json` and `en.json` carry the complete
  `landing.why.redesign` copy. Shared illustration labels and platform names
  reuse their existing namespaces.

Durable product and evidence constraints come from root `PRODUCT.md`. The
canonical visual reference remains `apps/web/DESIGN.md`; local chapter details
are recorded here and in its `extensions.whyComparison` sidecar metadata.

## Built composition

The hero pairs a left-aligned promise, registration action and comparison anchor
with a cyan project frame. The task board and violet conversation share the same
website-launch project identity. Desktop keeps all three board columns visible
behind a concise conversation excerpt; phones show both scenes in a vertical
stack. The shared official lockup identifies the page and a separate official
mark identifies the illustrated project frame.

Comparison sits on the soft-stage ground. Four original vendor marks accompany
named toggle buttons above a qualitative table. The table keeps five criteria
and the UniWork column stable: work organization, documents and knowledge,
conversations and meetings, AI and context, and what to test with the team.
The last row is an evaluation question; the page assigns no scores or missing
feature ticks.

Three separated proof rows then show focused task properties and reference
material on cyan, a cited Ask UNI answer on violet, and an output version/owner
example on mint. The middle row reverses the desktop visual order. Each row
keeps explanatory copy, two points, an existing feature-route link and an
illustration caption together. The output example explicitly says it is in
development. An unboxed evaluation invitation links to the Tasks introduction
before the inherited centered chapter ending.

## Local layout and motion

These measurements describe this chapter's CSS, not reusable token primitives.

| Area | Built behavior |
| --- | --- |
| Shared width | Maximum 1360px; inline gutters 32px, 24px at widths up to 1100px, and 16px at widths up to 767px. |
| Hero | `.8fr / 1.2fr` columns with a 56px gap and 40px/72px vertical padding. At widths up to 1100px it becomes one column, at most 900px wide, with a 32px gap. Phone padding is 20px/40px. |
| Project scene | Cyan frame with 16px corners and 20px padding, reduced to 12px padding on phones. Desktop board has a 48px trailing inset; chat is 52% wide, anchored at the lower right. At widths up to 767px chat becomes full-width in normal flow with a 14px scene gap. |
| Comparison | 56px vertical padding, reduced to 40px on phones. Picker buttons have 64px minimum height and 12px corners; marks are 32px, reduced to 24px on phones. Phone choices form a two-column grid. |
| Table | Native table with a fixed layout: 22% criterion column and two equal remaining columns (39% each). Cells use 22px/24px padding. On phones each row places the criterion above two paired cells; paired cells use 14px/12px padding and wrap long text. No horizontal scroll container is introduced. |
| Proof rows | `.7fr / 1.3fr` copy/scene columns, 72px gap and 40px vertical padding; the AI row reverses these widths and places copy second. At widths up to 1100px the gap becomes 36px. Phones stack copy before illustration with a 24px gap and 32px vertical padding. |
| Scene depth | A local soft navy-derived shadow separates the overlapping hero windows. Proof frames use 16px corners and 28px padding, reduced to 16px padding on phones. |

Headings inherit the marketing shell's existing page and section roles; copy
uses the existing body/title/caption roles. The hero scenes arrive once over
800ms with a 12px rise and shallow clip reveal, gated by
`prefers-reduced-motion: no-preference`. Reduced motion leaves complete static
content. Scenes do not start a playback loop.

## Comparison behavior, sources and product truth

Microsoft 365 is the initial choice. Four real buttons expose `aria-pressed`
and control the same table. Selecting a platform changes its summary, named
table header, five comparison cells and both source links together. The summary
uses a polite live region; the table has a translated caption and scoped column
and row headers. Shared button focus behavior remains visible. Source links
open official vendor pages in a new tab.

The source-check date displayed by the page is **29 September 2026**. The page
links Microsoft 365 business documentation, Notion product and enterprise
search pages, ClickUp features and its Brain documentation, and Coda product
and Packs pages. Copy acknowledges Notion's connected search and ClickUp's
context capabilities; Coda's current Superhuman Docs name is explained.
Descriptions compare working approaches and retain plan/configuration caveats.

Original icons live in `apps/web/public/landing/comparison/`. `origins.json`
records official source URLs. The three PNGs carry embedded provenance; the
Microsoft ICO uses `microsoft.ico.json` for provenance. These marks identify
comparison subjects and imply no partnership, endorsement or customer adoption.

UniWork availability is explicit in both locales: rich text and project
resources are available; standalone Documents is a future direction; Work
Products and approvals are in development. Email Hub requires service
configuration. Ask UNI requires model configuration and provides
permission-aware reading/search with sources; it is read-only. An autonomous
AI workforce remains a direction. The sample scenes establish neither released
capabilities nor customer, outcome or superiority claims.

## Verification and review scope

Recorded implementation checks passed: initial/final web TypeScript `noEmit`,
scoped ESLint, four locale-parity tests and three duplicate-key tests. The five
latest Why E2E scenarios passed (20.3s), covering all four choices at each
viewport, keyboard toggles, original-icon loading, source destinations, feature
navigation, translated content, overflow, contrast and unhandled exceptions.
The detector ran once on the Why TSX/CSS and returned `[]`; it was not rerun.
The provenance scan checked three rasters with no missing origin metadata; ICO
origin is recorded in its sidecar.

`.impeccable/review/why/checks.json` records zero horizontal overflow, no page
errors and no measured contrast failures for 1440px Vietnamese/light, 1510px
English/dark, 768px English/light, 390px English/dark and 320px Vietnamese/light.
The full fresh review opened all 31 captures, including individual phone/tablet
proof scenes. Its one material finding was ambiguous Documents availability.
Both locales were corrected, and the five latest comparison captures show the
longer distinction without clipping or overlap.

The same reviewer confirmed that finding resolved with no visible regression
from the fix batch. The `ship` disposition in
`.impeccable/review/why/verdict.md` covers **that scored copy fix only**; it is
not a whole-page certification. The desktop hero and five updated comparison
captures were also opened and validated. Screenshots are QA evidence, not
shipping assets or an approved comp.

`make check` could not run because `make` is unavailable on this Windows host;
the full repository aggregate remains unverified. This documentation records
the completed local composition and preserves earlier landing/CTA edits.
