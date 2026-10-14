# Office introduction — approved B

Recorded 2026-10-14. Surface: `/office` and the public Office menu, within the incumbent [UniWork design system](../../DESIGN.md).

## Decision and contract

The approved B selection rejected A, removes both lower Enterprise/Personal tiles, selects the prior centered B design and asks to use the existing Office trial downloads after updating from `origin/develop`. The [approved B comp](../../.impeccable/mocks/decision/office-20261014/b-centered.png), [exact prompt and approval](../../.impeccable/mocks/decision/office-20261014/b-centered.png.json), [current brief](../../.impeccable/mocks/decision/office-20261014/brief.md) and `office-centered` [QUALITY BAR card](../../.impeccable/mocks/decision/office-20261014/options.json) establish the current direction.

The user's explicit overrides supersede B's illustrated edition strip and original action wording. Native installed-editor dark appearance, localized editor labels and incumbent accessible header controls remain authoritative.

| Contract | Current expression |
| --- | --- |
| THESIS | UniWork Office is the desktop office app of the UniWork Work OS. |
| OWN-WORLD | Be Vietnam Pro, semantic white/charcoal ground and blue actions, restrained cyan/slate stage and sharp actual editor media. |
| STORY | Trial catalogue; six editors and selected capabilities; work examples; connected files/AI; FAQ; downloads and open/version/share workflow. |
| FIRST VIEWPORT | Centered short title and description, two actions, one six-editor rail and one broad native capture; no edition strip. |
| FORM | Explicit B approval, structure 1, seed `62bbd639`, with the user's removal/download overrides and native product/accessibility adaptations. |

## Layout and interactions

The centered hero uses one column. A stage up to (1120px) wide follows the title, concise description and paired actions. The heavy title uses existing hero roles, weight (800), line height (1.1) and tracking (−.035em): fluid (48–60px) on desktop, (48px) below (1100px), (36px) below (640px). Following the user's insufficient-height screenshot, the capture uses its natural height at every breakpoint, displaying the full native image instead of clipping its lower content to a fixed aspect ratio. At the maximum stage width, the 2400×1500 image is 690px high inside the padded frame. The existing frame uses (14px) corners and the scoped header (18px); A's curved side plane is removed.

One Base UI tablist selects Docs, Sheets, Slides, PDF, HTML or Markdown and shows one themed capture. Vietnamese keeps Văn bản/Bảng tính/Trình chiếu; English keeps Docs/Sheets/Slides. The compact summary below the stage retains every description and three factual points. Its native title-lg heading is (20px), with a (.9fr/1.1fr) grid and (48px) gap; below (640px) it stacks. The selected panel references the summary using `aria-describedby`. Tab scrolling stays within the rail. The selected panel now also carries its original work example, replacing the separate grid and repeated editor links.

The blue primary trial action reaches `#office-download`; the secondary action requests a demo through the canonical route. The Office closing action now reads “Explore the editors” / “Khám phá bộ soạn thảo” with ArrowRight and returns to the preview. Its label describes that destination.

Both lower edition tiles are removed. The five-destination public navigation retains **Office for Enterprise** as the `#office-business` destination and **Office for Personal** as a static development item in both locales, with “Đang phát triển” / “In development”. Personal has no clickable availability destination, download, release date or sign-up promise. The shared six-question FAQ remains keyboard operable.

## Real trial catalogue

`origin/develop` was integrated at `78e441abd` with local work preserved. The current API build, migrations and startup succeeded. Existing committed deployment configuration supplies whitelisted installer URLs to the public catalogue; UI links and version come from that catalogue.

The [verified release metadata](../../.impeccable/review/office-B/release-assets.json) records five uploaded `v0.11.0-dev.7` variants and checksums. This environment exposes five dev variants; beta/stable are empty. The hero reaches the existing per-OS download section, without a duplicate OS row or hardcoded release URLs. Unpublished variants remain absent, and loading, valid empty deployment, error/retry, requirement and unsigned-notice behavior is retained.

The Windows test opened the actual GitHub release download, verified the download event and filename, then cancelled the transfer. It proves the link initiates the expected download; it does not establish full binary delivery or installation. No trial duration is claimed.

## Media and provenance

The unchanged [production manifest](../../apps/web/public/landing/office/manifest.json) records (24) actual (2400×1500) WebP captures: six editors × two locales × two themes. Each has an origin sidecar; the current scan found (0) missing origins. Twelve light rasters retain their committed bytes; twelve dark rasters were captured from pinned native `0.1.0-0d03b18` renderer frames. B required no new shipping raster assets. That renderer version is distinct from the downloadable desktop release `v0.11.0-dev.7`.

CSS selects the corresponding native locale/theme image before hydration. Failure shows a localized status and recovers when the source changes. No recoloring, filter or dim overlay is used. Native dark Docs paper supersedes the generated comp's white sheet, and captions identify illustrative sample content.

The original dark capture workflow used real committed sample bytes in a local frame fixture after authenticated upload returned (503 `storage_unavailable`). Those images establish renderer appearance, not authentication, backend upload/save, customer results or AI execution. The fixture exposes the real empty AI panel. Historical light origins retain exact committed sources, but their original timestamps and browser sessions were not retained.

## Review and verification

The [Office B packet](../../.impeccable/review/office-B/packet.md) records all (29) valid current captures: exact user viewport (1306×746), responsive first folds, light/dark comp panels, both complete pages, twelve section crops, both menu contexts and three closing-action crops. The current [comp-size checkpoint](../../.impeccable/review/hero-repro.png) is (1254×1254). Current evidence lives under `.impeccable/review/office-B/`.

The [fresh full review](../../.impeccable/review/office-B/finish-review.md) returned `fix` for one material issue: the closing “Watch demo” label led to the editor selector. The corrected label/icon/destination passed the [finish verdict](../../.impeccable/review/office-B/finish-verdict.md), which returns `ship` for the scored closing-control fix, with no regressions. This is not a new full-surface ship review.

Final recorded checks:

- Nine focused Playwright passes (43.3s), including the corrected closing action, sole tablist/capture, all six synchronized summaries, native locale/theme media, keyboard operation, trial anchor and real download, demo route, Personal menu status, responsive bounds and rendered contrast.
- Scoped ESLint, web `tsc --noEmit` and `git diff --check` passed after the fix.
- Core i18n parity/paths: eight passes; Go OfficeInstaller configuration tests passed.
- Detector output was `[]` from one run; no rerun after the closing fix. Provenance: (24) rasters, (0) missing origins.
- `make check` was attempted, but Make is unavailable; no full repository gate pass is claimed.
- UniAI initially failed to connect, then reconnected: issue retrieval and the agent comment succeeded.

## Historical A

[A's comp](../../.impeccable/mocks/decision/office-20261014/a-split.png) and [original approval/prompt](../../.impeccable/mocks/decision/office-20261014/a-split.png.json) are preserved as history. A was initially approved, then refined to remove its repeated lower editor stage; its earlier tests and [deduplication review](../../.impeccable/review/office-dedup/finish-review.md) preceded the user's explicit rejection of the split opening and edition tiles. A's (48px) side contour and (1806×871) checkpoint dimensions are historical, not B's current geometry or checkpoint.

## Source boundary

Current implementation: [office-page.tsx](../../apps/web/features/landing/office-page.tsx), [office-editors.tsx](../../apps/web/features/landing/office-editors.tsx), [office-data.ts](../../apps/web/features/landing/office-data.ts), [office.css](../../apps/web/features/landing/office.css), [office-downloads.tsx](../../apps/web/features/landing/office-downloads.tsx) and [header-directory.tsx](../../apps/web/features/landing/header-directory.tsx)/[CSS](../../apps/web/features/landing/header-directory.css). [MarketingShell](../../apps/web/features/landing/marketing-shell.tsx) passes the Office closing action to [FinalCta](../../apps/web/features/landing/final-cta.tsx). Surface decisions belong here; the shared normative system remains in DESIGN.md.

## Preview height correction
The latest user screenshot shows insufficient preview height. Natural height now supersedes fixed desktop/tablet aspect caps and earlier first-fold containment. Current evidence is in .impeccable/review/office-height/: six first folds, six legible full preview crops and two whole-page contexts. The real-Chrome check selected all six editors at six viewport/theme scenarios (36 cases), decoded the images and proved each image bottom lies within its frame, with no horizontal page overflow. Previous nine-test and closing-review results above are historical to this CSS-only correction. A fresh full height review is recorded separately in that folder. Original B prompt, 24 shipping rasters and global tokens are unchanged.

Height correction review: .impeccable/review/office-height/finish-review.md returns ship at the requested preview-height and B-placement scope, with no material fixes. Verification: 36 real-Chrome image-bounds cases passed; no current whole-application or API gate is claimed. The current natural-height instruction supersedes earlier compact-crop/first-fold requirements.

## Workflow CTA removal
The user removed the redundant Get started action beneath the three Office workflow descriptions. The open/version/share descriptions remain; the established hero trial/demo actions and shared closing remain. The loaded app was checked at1440px light and390px dark: no registration link in the workflow section, all three descriptions retained.
The fresh scoped review in .impeccable/review/office-remove-cta/finish-review.md returns ship with no material fixes. Current pre-push evidence:13Office/demo E2E passes (54.1s), web typecheck, web/core/admin scoped lint,10core tests,2admin tests and3real-database Go demo tests passed. make check remains unavailable because Make is absent.

## Content distillation — 2026-10-14

The user accepted the proposed optimization of two lower content blocks with “triển khai cho tôi”. All six original examples now live inside their corresponding selected-editor tabpanel, beside the retained description and three capability points. This replaces the separate six-card grid and its six redundant “Mở” links with the existing single selector. No example or editor capability is lost.

The connection block presents three short principles: one UniWork account, organization AI plan or private API key, and organization permissions for workspace files. A semantic local-files ↔ workspace diagram labels manual opening/saving versions and the connection requirement. It uses the existing theme tokens and Lucide icons, two actual storage nodes and an explicit bridge; it does not imply automatic synchronization. It stacks on mobile. No new raster assets or global tokens are introduced.

Two shared Base UI accordion disclosures retain the detailed AI/provider-routing and file/connectivity information. The existing privacy FAQ answer is also available inside the AI disclosure. Both disclosures begin closed and remain keyboard accessible. Body measure is capped at (75ch), following the one material finish finding. Centered B, natural native image height, trial/demo, menu, download catalogue, FAQ and workflow/closing are retained.

Current evidence: [packet](../../.impeccable/review/office-distill/packet.md), [scoped review](../../.impeccable/review/office-distill/finish-review.md) and [fix verdict](../../.impeccable/review/office-distill/finish-verdict.md). The full scoped review returned fix solely for the (90ch) disclosure measure; the correction to (75ch) receives ship at the scored fix scope. Six real-Chrome E2E tests passed after correction, covering all six editor/example/media combinations in five responsive/theme/locale scenarios, keyboard operation, truthful disclosures, contrast, preview image bounds, real catalogue and demo destination. Fifteen Office unit tests, five core parity tests, scoped ESLint, web typecheck and diff check passed. One detector returned []; no second pass. Make is unavailable for the attempted repository gate.

New source: [office-connection.tsx](../../apps/web/features/landing/office-connection.tsx). Current captures are under .impeccable/review/office-distill/; older review counts above are historical. This request does not authorize a new backend/storage behavior, release claim or Git push.
