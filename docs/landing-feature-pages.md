# Product feature pages

Scope: the 18 `/features/[feature]` pages in the Product menu and `/features`.
Mode: Persuade. Extend the existing Bright Studio world, Vietnamese first, with
the user's colorful futuristic direction and more concrete visual examples.
Do not change the app's authenticated screens, global identity, pricing or claims.

This is an established-world, shared-template extension. `apps/web/DESIGN.md`,
`PRODUCT.md`, `.impeccable/design.json` and the existing tokens remain authoritative.
There is no new identity, seed, direction tournament or approved comp. This brief
records the implemented surface, not a replacement global design system.

## Composition and material

The first viewport pairs the existing product promise and actions with a readable
HTML sample interface. Its paper window tilts slightly in perspective over a
colorful tonal stage, with a soft offset shadow. Be Vietnam Pro, cobalt actions,
semantic typography and the existing light/dark palette carry the studio identity.

Group accents come from existing semantic tokens: communication uses cobalt with
cyan/mint; results uses the brand accent with violet/coral; knowledge uses cobalt
with mint/cyan; AI uses the brand accent with violet/cyan; organization uses success
with mint/lime. The default uses cobalt with the studio stage/cyan. These local
aliases introduce no global tokens.

Three workflow examples follow the hero. The first row has unequal columns
(1.2:1); the final row spans both columns with the illustration on the left and
its original product point on the right. The existing full `ProductPlayback` or
`LovableReference` follows, retaining playback, expansion and other actual controls,
plus availability beside its heading. Related-feature links complete the chapter.

The memorable thread is the same launch project moving between work, conversation,
documents and permissions. Product copy, feature routes, canonical URLs, registration
and demo destinations remain unchanged. Partial and planned capabilities retain
their truthful availability in the hero and beside the full preview; sample data
and progress introduce no customer performance or release claims.

## Illustrative scenes

`FEATURE_SCENES` maps every feature to a hero (index 0) and three examples
(indices 1–3). Fourteen base scenes cover board, focused task, schedule, conversation,
call, email, document, library, workflow, answer, team, roles, activity and overview.
They are authored DOM with Lucide icons, not shipping raster assets.

The implementation varies workflow content as well as decoration:

| Feature / example | Distinct scene treatment |
| --- | --- |
| Board scene, index 1 | List view instead of the hero board |
| Schedule scene, index 1 | Month view instead of the week view |
| Focus scene, index 3 | Attached conversation context |
| Projects, index 1 | Project portfolio |
| Email, indices 1–3 | Message reader, starred messages, configured connection |
| Agents, indices 1–3 | Agent profile, human/agent identities, foundation and roadmap scope |
| Ask UNI, index 3 | Read-only source access and human decision |
| Documents, index 3 | Collaboration in the editor direction |
| Knowledge, index 3 | Guide, source document and related-task context |
| Outputs, index 3 | Version and related-task detail |
| Audit, index 3 | Actor, event, time and workspace record detail |
| Workflows / automation, index 3 | Draft condition/action rule with a non-execution disclosure |

`/features` uses 18 cropped thumbnails of these actual HTML hero scenes, grouped by
product area. A visible translated disclosure states that the interfaces use
illustrative data and that availability is recorded on each feature page.

## Responsive behavior and semantics

The hero uses near-equal columns above 1100px and stacks at 1100px. At 767px and
below, all three examples stack visibly; the final row becomes illustration then
copy. The hero loses its tilt and entrance animation. Dense month/week scenes show
fewer cells or columns, while retaining a visible illustrative scene. The directory
changes from three columns to two at 1100px, then one at 767px.

Hero and example illustrations expose `role="img"` with translated sample/scene
labels; their inner decorative markup is `aria-hidden`. Directory thumbnails are
decorative inside the labeled feature links. Sample interfaces contain no fake
interactive controls. Text and disclosures use `landing.featureVisuals` in both
`packages/core/i18n/locales/vi.json` and `en.json`.

Motion is finite: the hero window has a 0.8s entrance and the full preview a 0.6s
entrance, both only under `prefers-reduced-motion: no-preference`. Reduced motion
retains the entire composition. This surface adds no continuous animation.

Sources: `apps/web/features/landing/feature-page.tsx`, `feature-illustration.tsx`,
`feature-visuals.css` and `marketing-pages.css`; `marketing-shell.tsx` imports the
scoped styles. Other marketing surfaces keep their own composition.

## Validation and finish review

The finish review is closed. A fresh reviewer initially requested fixes for
repetitive examples and the missing directory disclosure. After one fix batch,
the same reviewer confirmed both resolved, all 36 recaptures valid, and no observed
regression from those fixes. The `ship` disposition applies **only to those two
prior findings**; it is not unconditional approval of the entire surface.

`.impeccable/review/feature-pages/checks.json` records 18 scenarios representing
desktop, the user's 1254px viewport and mobile 320/390px, Vietnamese/English, and
light/dark modes. Each records no horizontal overflow, page errors or text-contrast
failures. All 36 image files in that directory were opened and confirmed valid.
These screenshots are QA evidence, not shipping assets.

Recorded checks passed: TypeScript `noEmit`; scoped ESLint for `feature-page.tsx`,
`feature-illustration.tsx` and `marketing-shell.tsx`; seven combined
`landing-product-pages` and `landing-feature-visuals` Playwright E2E tests using
installed Chrome; four i18n parity tests; three duplicate-key tests; and
`git diff --check`. The detector ran once and returned `[]`; it was not rerun.

`make check` was attempted but could not run because this host lacks `make`.
The full repository aggregate is therefore unverified. The illustrative scenes,
sample metrics and task-specific composition are not new global design rules or
evidence that planned capabilities are released.
