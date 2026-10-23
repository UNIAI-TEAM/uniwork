# Public introduction content distillation

2026-10-14. User request: check the other introduction pages for duplicated content and optimize it. This refines the incumbent public studio; it does not introduce a replacement visual world or new product claims.

## Scope and decisions

The source and rendered-content inventory covered 28 routes: home, the feature/solution directories, both department solutions, Learn, Pricing, Enterprise, Why UniWork, Changelog and all 18 feature introductions. Office keeps its separately approved refinement.

| Surface | Redundancy | Current treatment |
| --- | --- | --- |
| 18 feature introductions | Three large example illustrations in sequence and a third copy of the same availability paragraph | Keep all three titles and original explanations visible in a vertical Base UI tablist. One illustration follows the selected example. Retain the separate full preview and its controls. Availability stays at arrival and next to the full preview; the copy inside the third example is removed. |
| Pricing | The same commercial-plan disclaimer in the hero and quota block; a hidden duplicate introduction still in the document outline; the first comparison row restating the actual offer | Keep the disclaimer with the actual offer. The dedicated page supplies the introduction; shared Pricing omits its inner introduction only there and retains an accessible section name. The comparison keeps its distinct AI/resource and Enterprise/deployment rows. Home retains the original introduction. No prices, quotas or release commitments change. |
| Enterprise | A governance table followed by three illustrated sections explaining the same access, audit and AI scope | Put each original confirmation question alongside its relevant example. Retain separate role scopes, actor attribution, append-only history, read-only AI, model configuration and the unpublished Enterprise/SLA notice. Remove the redundant table and overlapping introductory sentences. |
| Why UniWork | An evaluation action block immediately followed by another shared closing block | One shared closing uses the original evaluation title, explanation and trial action label/destination. Comparison criteria, vendor sources, three proofs and availability remain. |
| Learn / Operations | The hero reused exactly the same task/role illustration as a later example | Use the existing board/member overview in the hero; retain the focused task/role scene in the explanation. No new raster or factual content. |

The other directory, product-solution and changelog content has distinct purposes and remains. Home's repeated authored sample conversation belongs to the same illustrated project, rather than repeated marketing copy. Navigation links and conversion actions at arrival and closing have separate contextual purposes.

## Interaction and layout

Each feature example has a real tab button and corresponding panel. All three explanations stay readable; selecting a title changes only its illustrative media. A brand outline distinguishes selection from hover. Arrow Up/Down, Home/End and activation follow the existing Base UI primitive. The feature key remounts the selector on route changes, returning to the first example. A two-column stage stacks on narrow screens; the original hero, related routes and full expandable preview remain. The list illustration's duplicated context note is removed, retaining the same context in its footer.

Enterprise confirmation questions use an inline label under their factual description, with an h2 for the governance section and h3 for each topic. Shared closing and pricing extensions default to the previous behavior for other callers. The pricing introduction has a named class instead of positional first-child styling.

No locale keys, global tokens, release claims, backend behavior or bitmap assets are added. Native browser focus and the existing semantic light/dark colors remain.

## Evidence

Inventory and before/after captures: `.impeccable/review/marketing-distill/`. Focused Playwright exercises all feature examples, keyboard selection, responsive bounds, introduction consolidation, disclosures and actual preview/navigation destinations. Final verification is recorded in that folder's packet. The full repository gate cannot run in this environment because Make is unavailable.

## Hero action alignment correction

The user's dark-theme Pricing and Solution screenshots exposed an 8px center offset. Standalone `.chapter-link` spacing was inherited inside a flex action row; only the light-theme stylesheet reset it. The reset now belongs to shared `.marketing-actions .chapter-link`, with the obsolete light-only override removed. Standalone links keep their established spacing.

Real Chrome measured 56 route/viewport/theme/locale cases across seven introductions, 1440px/390px, light/dark and vi/en. Same-row action centers have zero drift after the fix. Before/after crops and metrics live under `.impeccable/review/cta-alignment/`. One scoped detector and diff check passed; this CSS correction did not rerun the full repository gate.
