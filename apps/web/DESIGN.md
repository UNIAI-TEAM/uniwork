---
name: UniWork Public Marketing
description: Luminous Bright Studio marketing with scarce cobalt action and tangible shared context.
colors:
  brand: "#0b5bf5"
  brand-dark: "#4d8dff"
  brand-foreground: "#ffffff"
  brand-foreground-dark: "#0d1220"
  landing-stage: "#edf2ff"
  landing-stage-dark: "#192741"
  landing-stage-soft: "#f3f6fc"
  landing-stage-soft-dark: "#172132"
  landing-paper: "#ffffff"
  landing-paper-dark: "#1c2638"
  landing-mint: "#ddf7eb"
  landing-mint-dark: "#17352c"
  landing-violet: "#ede7ff"
  landing-violet-dark: "#30264b"
  landing-cyan: "#dcf6ff"
  landing-cyan-dark: "#123747"
  landing-lime: "#eef8cf"
  landing-lime-dark: "#2b3619"
  landing-coral: "#fff0e8"
  landing-coral-dark: "#3c2721"
  landing-deep: "#101f42"
  landing-close-start: "#0754d8"
  landing-close-end: "#8731c5"
  landing-close-light: "#15aede"
  landing-close-foreground: "#ffffff"
  landing-model-shell: "#f4f7ff"
  landing-model-light: "#b9eaff"
  background: "#fafafa"
  background-dark: "#111113"
  foreground: "#18181b"
  foreground-dark: "#f4f4f5"
  muted-foreground: "#52525b"
  muted-foreground-dark: "#a1a1aa"
  border: "#e4e4e7"
  border-dark: "#2a2a2e"
  input: "#87878f"
  input-dark: "#6d6d76"
  success: "#15803d"
  success-dark: "#4ade80"
typography:
  display:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "clamp(36px, 4vw, 52px)"
    fontWeight: 700
    lineHeight: 1.18
    letterSpacing: "-0.035em"
  display-tablet:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "clamp(34px, 4.6vw, 46px)"
    fontWeight: 700
    lineHeight: 1.18
    letterSpacing: "-0.035em"
  display-mobile:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "clamp(32px, 7vw, 36px)"
    fontWeight: 700
    lineHeight: 1.18
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "18px"
    fontWeight: 600
  body:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.8
  body-intro:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.8
  control:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "16px"
    fontWeight: 500
  label:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "12px"
    fontWeight: 600
rounded:
  control: "8px"
  card: "12px"
  media: "14px"
  scene: "36px"
spacing:
  compact: "12px"
  related: "16px"
  content: "24px"
  group: "32px"
  section-mobile: "60px"
  section-tablet: "72px"
  section: "100px"
components:
  button-brand:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-foreground}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 26px"
    height: "52px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 26px"
    height: "52px"
  button-closing:
    backgroundColor: "{colors.landing-close-foreground}"
    textColor: "{colors.landing-deep}"
    rounded: "{rounded.card}"
    padding: "0 26px"
    height: "52px"
  preview-task:
    backgroundColor: "{colors.landing-stage-soft}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "14px"
  solution-row:
    backgroundColor: "{colors.landing-paper}"
    textColor: "{colors.foreground}"
    rounded: "18px"
    padding: "20px"
  media-window:
    backgroundColor: "{colors.landing-paper}"
    rounded: "{rounded.media}"
  preview-input:
    textColor: "{colors.foreground}"
    rounded: "10px"
    padding: "4px 10px"
    height: "44px"
---

# Design System: UniWork Public Marketing

## Overview

**Creative North Star: "Bright Studio"**

Bright Studio makes shared work tangible through spacious type, one integrated product sandbox and three distinct illustrative media: a supportive 3D work core, the approved UNI horse illustration with restrained 2.5D motion and an authored workflow film. The opening pairs an opaque floating navigation dock with centered copy above the original work core and four supporting context labels. One hero conversion action establishes the hierarchy; a feature chooser and expandable detail keep the page focused on one subject at a time. The color strategy is luminous and optimistic: soft cyan, coral, violet, lime and mint support scarce cobalt action and the connected workflow. Large, rounded presentation frames share a common width and clear page-colored gutters. Three audience choices drive one branded Solutions preview before the cyan AI frame and contrasting dark trust stage. The future-facing roadmap pairs a visual Work Graph concept with explicit phase labels; the homepage FAQ ends with a navy brand story. Dark mode is composed as teal, violet, warm coral and navy atmosphere rather than a mechanical inversion.

This document records the public marketing implementation under `features/landing`, including the home page, dedicated product introductions and shared navigation. It does not redefine authenticated application UI. The user pinned a ClickUp/Motion-inspired direction, chose a polished AI horse with web motion, and supplied seven Lovable screenshots as future interface direction. Their layout informs the landing previews and remaining sections; the shared theme, Be Vietnam Pro and official identity remain authoritative. The references are not evidence of released develop UI or an approved page comp. The illustrative UNI horse is a marketing exception, not a new authenticated agent-avatar standard. `landing-page.tsx` carries inherited contract identifier `277f981e`; the original roll artifact is unavailable, and no approved comp or QUALITY BAR is asserted. The `uniwork-product-pages` contract in `marketing-shell.tsx` extends this world through the user-pinned ClickUp product-page canon: understand a feature before entering its demo.

**Key Characteristics:**

- Be Vietnam Pro across marketing headings and body copy.
- Luminous, optimistic surface color with scarce cobalt action and semantic four-color workflow stages.
- One hero conversion action and one integrated product control system.
- An opaque floating navigation dock and centered hero lead into the original work core, with readable context labels and a compact overlaid motion control.
- Stationary official identity with detailed moving work objects, the original UNI horse illustration and cinematic media.
- Product choice and progressive disclosure replace repeated feature explanations.
- Grouped navigation opens dedicated introductions; explicit Watch demo links enter the homepage sandbox.
- Crisp framed scenes expand into their shared width on scroll; copy arrives once and stays readable.
- Manual playback controls, reduced-motion defaults and offscreen suspension.
- Explicit illustration and roadmap labels preserve the difference between example and evidence.
- Related facts share the trust and future stages; separate subjects retain clear gutters and aligned frame edges.
- Flat solution and disclosure rows use semantic outlined icons; Work Products retains its existing colored modules.
- An example audit record and compact provider band communicate governance and model choice without adding controls.

Extraction sources: `features/landing/landing.css`, `landing-motion.css`, `landing-explorer.css`, `landing-stages.css`, `landing-workspace.css`, `landing-playback.css`, `landing-reference.css`, `landing-highlight.css`, `landing-focus.css`, `landing-decisions.css`, `landing-ai-stage.css`, `landing-opening.css`, `landing-dual-navigation.css`, `workspace-app-navigation.tsx`, `site-header.tsx`, `hero.tsx`, `showcase.tsx`, `capabilities.tsx`, `today-preview.tsx`, `reference-previews.tsx`, `trust-band.tsx`, the landing disclosure sections, `product-preview.tsx`, `product-playback.tsx`, `animation/use-preview-playback.ts`, `interactive-scene.tsx`, `horse-mascot.tsx`, `workflow-film.tsx`, `animation/scene-models.ts`, `animation/scene-renderer.ts`, `animation/mascot-renderer.ts`, `animation/landing-motion.tsx`, `platform/landing-font.ts`, and `../../packages/ui/styles/tokens.css`. Durable product context is `../../PRODUCT.md`; identity rules are in `../../packages/ui/brand/README.md`. The implementation remains the source of truth; this is its scoped reference.

Dedicated-page sources: `features/landing/header-directory.tsx`, `header-directory.css`, `marketing-shell.tsx`, `marketing-pages.css`, `feature-page.tsx` and `marketing-overview-pages.tsx`.

Closing-component sources: `features/landing/final-cta.tsx`, `landing-closing.css`, `lovable-frame.tsx` and `product-playback.tsx`; `marketing-shell.tsx` also appends the shared closing component to dedicated pages.

## Colors

Cobalt carries the strongest action emphasis; broader color lives in soft supporting planes. Light mode feels luminous and optimistic, while theme-paired teal, violet, warm coral, olive-lime and navy create a composed dark atmosphere. The palette separates connection/technology, human conversation, AI/context and progress without turning each region into a competing action.

The hero retains its cyan field. The product stage separates the external feature selector from a full application illustration. Scoped `preview-*` theme tokens reproduce the observed Lovable white/near-black canvas, neutral panels and violet controls. Marketing colors and brand artwork remain unchanged; manual exploration retains the navy rail. Later sections keep cyan for UNI, navy for trust and paper for pricing. The shared closing component uses the user-pinned blue-to-violet field with cyan bottom light; this scoped conversion composition does not change the broader scarce-cobalt palette strategy.

### Primary

- **Cobalt Ink / Bright Cobalt:** `brand` and `brand-dark` identify actions, active preview modes, linked context and icons. Pair filled buttons with their matching `brand-foreground` value.
- The shared shadcn `primary` slot is neutral; it is not a synonym for marketing cobalt.

**The Scarce Cobalt Rule.** Within public marketing, keep saturated cobalt concentrated on primary actions, active controls and connecting signals; use softer semantic surfaces for larger color areas.

### Secondary

- **Connection Cyan / Progress Lime / Conversation Coral:** the `landing-cyan`, `landing-lime` and `landing-coral` pairs provide theme-aware supporting planes. Alongside violet, they distinguish the four workflow stages while the connecting rail remains cobalt. Their chapter atmospheres are supporting color, not new action variants.
- **Soft Mint / Soft Violet:** the current `landing-mint` and `landing-violet` pairs distinguish example members, selected context and illustrative groupings. Violet carries the AI/context association; mint also settles the product band's ending.
- **Completion Green:** the `success` pair marks completed status and checks. Status also has a text or icon cue.
- **Closing Blue / Closing Violet / Closing Cyan Light:** `landing-close-start`, `landing-close-end` and `landing-close-light` compose the closing frame's gradient and lower-left light. Their values are identical in both themes; the product illustration inside still follows the page theme.

### Neutral

- **Studio Mist / Cobalt Wash / Preview Paper:** the `landing-stage-soft`, `landing-stage` and `landing-paper` pairs separate page sections, selected preview content and the product window.
- **Trust Navy:** `landing-deep` is unchanged between themes. Trust content explicitly enters a dark subtree; the closing component does not. Its white action uses navy text and its local shadows use navy depth.
- **Closing White:** `landing-close-foreground` supplies the closing heading, sample label and registration button surface in both themes.
- **Reading Ink / Secondary Ink / Quiet Divider / Control Edge:** foreground, muted foreground, border and input pairs keep hierarchy, separators and interactive outlines distinct.
- **Porcelain Shell / Pale Cyan Frost:** `landing-model-shell` and `landing-model-light` are physical 3D material inputs, declared identically in both themes. They give the core its light porcelain surfaces and translucent supporting detail.

Unsuffixed frontmatter colors are light values; `-dark` entries record the matching `.dark` value. Runtime code uses the unsuffixed CSS slot, not a second variable named with `-dark`. `landing-ink` exists in the token file but is unused by this landing CSS and is deliberately not extracted.

The live core samples brand, shell, navy and light slots when its scene is created. A subsequent theme toggle updates surrounding CSS and the shared Logo without rebuilding existing WebGL materials. The horse renders the exact approved image without relighting or recoloring; its shirt mark is the shared Logo DOM component.

**The Semantic Theme Rule.** Read color from the shared semantic slots; every themed slot must exist in both light and dark declarations.

## Typography

**Display Font:** Be Vietnam Pro (sans-serif fallback).  
**Body Font:** Be Vietnam Pro (sans-serif fallback).

The fitted Lovable illustration alone uses the observed native UI sans-serif stack at its desktop canvas size; surrounding landing copy and actual controls retain Be Vietnam Pro. Reference violet is slightly darkened in light mode to keep small text above 4.5:1 on soft panels.

One family carries Vietnamese and English with weight contrast and generous leading. The font loader supplies 400, 500, 600, 700 and 800. Some preview, audience, explorer and TrustBand headings or labels request 650 in CSS; this is recorded as an implementation detail, not a new loaded weight.

### Hierarchy

- **Display:** the centered hero reads `--text-hero-opening`, then `--text-hero-opening-tablet` below 1100px and `--text-hero-opening-mobile` below 768px. These roles live in the shared token stylesheet and map to the three frontmatter display entries; the local opening stylesheet supplies their final leading and tracking.
- **Headline:** section headings read `--text-hero`; they reduce to `--text-hero-sm` below 1024px. The composed AI and Security sections use `--text-hero-sm`, reducing to `--text-display-sm` below 768px for AI and 600px for Security. The closing heading uses the existing hero-lg / hero / hero-sm roles (60px / 48px / 36px) at desktop / below 1024px / below 768px, with 1.12 leading (1.18 on mobile), -0.035em tracking and a 28ch / 22ch / 17ch maximum measure. These are scoped uses of existing type roles.
- **Title:** compact headings use the existing title roles. Explorer descriptions use `--text-display-sm` (24px), dropping to `--text-title-lg` (20px) below 1024px; workflow labels use `--text-title-sm` (16px).
- **Body / Body intro:** detailed copy uses `--text-body-lg`; section introductions use `--text-title` with a maximum measure of 60ch, reducing to `--text-title-sm` on mobile. The compact centered hero introduction uses `--text-body-lg`, 1.6 leading and a 760px maximum measure (34ch on mobile).
- **Control / Label:** principal actions use `--text-title-sm`; preview annotations and status labels use `--text-caption`. Preview task names and navigation use `--text-body` (14px).

The frontmatter records final landing declarations, including local leading/tracking overrides, rather than assuming the shared type token's default leading survives. These are semantic roles, not a new numeric font ramp.

Dedicated introductions retain the same family, with locally fitted page titles (`clamp(34px, 3.8vw, 58px)`, 1.16 leading) and section headings (`clamp(25px, 2.5vw, 36px)`, 1.25 leading). Their requested 650 weight remains an implementation detail of the existing font loader, not an additional font weight or an authenticated-app type rule.

**The Vietnamese Coverage Rule.** Marketing headings and body use the same Vietnamese-capable family; hierarchy comes from role, weight and spacing.

## Layout

The shared container remains 1280px wide with 16px side padding (24px from 640px); the 1400px opening and hero are unchanged. The product stage has a 204px external selector, narrowing to 176px below 1100px and stacking above the preview at ≤900px. Watch mode uniformly fits a complete desktop illustration. Only manual mode retains the 76px app rail (68px below 1100px, horizontal at ≤600px) and 560px desktop / 540px mobile body minimum. The Solutions introduction groups its heading and description on the same left edge, above the existing audience selector and preview. Its heading measure is 24ch; supporting copy is at most 64ch in the body-lg role. Their gap is 16px, followed by 32px before the selector (12px and 24px below 768px). Section padding is 64px above and 48px below, reducing to 40px and 32px on mobile.

The frontmatter section spacing remains the base rhythm. Framed scenes, including the homepage product stage, are at most 1400px wide, with 32px desktop, 20px tablet and 12px mobile minimum outer gutters. Scene corners are 36px, 28px and 24px respectively; these are large stage boundaries, not the card-radius system. The workspace's application frame has 16px corners. The product stage retains 12px inner side padding on desktop and none below 768px; it no longer expands independently to the viewport edges. The visible section heading and description are removed, retaining a screen-reader section heading. Vertical padding is 16px desktop / 12px mobile. Other content sections generally use 80–112px desktop and 64px mobile spacing. Native page scrolling remains unchanged; only sandbox boards can scroll locally.

The product story reads unified workspace → team solutions → AI. The earlier ClickUp reference defines the left-selector/right-preview composition; the Lovable references inform the active preview topology and the editorial rhythm below it. The AI heading, benefits and Ask UNI preview link share one cyan frame with the horse before dark trust content. WorkProducts is a disclosure inside the future-facing roadmap. Feature truth and configuration caveats remain sourced from develop, recorded in `../../docs/landing-develop-sync.md`.

Framed scenes keep a clear 24px separation and align to one width. There is no masking-based crossfade, overlapping chapter ground or page-edge rail. The supplied ClickUp screenshots define the composition reference: large white-ground typography, strong illustrative scenes and a clear colorful-to-dark handoff; no competitor assets or claims are copied.

The homepage trust chapter is owned by `landing-trust.module.css`, avoiding conflicting global route styles. Security uses a .9fr / 1.1fr grid with a 64px gap: short left-aligned copy and three 56px disclosure rows beside a labelled audit record. Each group preserves two facts and caveats, opening one group at a time. The record leads with the task, then actor/time, before/after assignment, two-column scope/trace metadata and the existing exploration link. The chapter uses 48px side insets (32px below 1100px, 20px below 600px) and Security has 48px/32px vertical padding (32px/24px below 600px). At 900px the main grid stacks in DOM order; below 600px record metadata also stacks and the heading uses display-sm. Cyan-tinted text, a single slate audit surface and fine separators retain the navy identity without extra decoration.

Within this chapter only, TrustBand uses 20px vertical padding, with its body-sized heading beside three unboxed provider labels. At 900px the heading moves above a wrapping list; labels do not become full-width cards. The concluding market teaser uses 24px vertical padding and title-sm copy beside the analysis link, stacking at 900px with an 8px gap. Provider and teaser content remain subordinate to the governance example. TrustBand on the other marketing routes retains its existing standalone styling.

Six product families form the external navigation on desktop. At ≤900px the family controls become a three-column, two-row selector followed by the active family's child tabs. Fitted watch illustrations preserve their full desktop topology on mobile; expansion and detail scrolling allow closer inspection. Manual task boards scroll only within their stage. Security, FAQ, Work Products and other landing sections retain their existing responsive behavior.

Dedicated feature introductions use a left-aligned promise and actions beside one fitted product illustration inside a 1600px maximum-width hero. The two columns stack at ≤1100px; below 768px the visual padding narrows and benefits, related links and directory entries stack. The shared header independently switches to its mobile menu below 1200px. Introductory directories use readable grouped rows with quiet separators; product pages follow with one detail section, three benefits and related routes. These are page-level compositions within Bright Studio, not changes to the homepage sandbox geometry.

The opening core canvas is 230px high and occupies 64% of its frame on desktop, 68% below 1100px, then the full width at 200px high below 768px. Its context labels remain outside the canvas. The media footer and caption are removed; a quiet pause/play control overlays the artwork without adding a row. Inside the cyan/violet AI frame, the horse stage is 600px high on desktop, 470px at widths up to 1100px and 380px below 768px. The original square cutout keeps its proportions and has headroom for a small foreleg wave. The same image remains visible when rendering is unavailable. The AI stage is two columns on desktop and one on mobile, with copy preceding the horse. The film retains its 3:2 frame.

Roadmap pairs large introductory copy with a dark illustrative Work Graph scene. WorkProducts then spans a full-width disclosure above three phase disclosures; the graph and phases stack below 768px. Its no-release-date notice stays outside the accordion. Pricing joins the navy Starter plan and eight metered-category rows inside one elevated 22px frame; the plan holds its single registration action and retains the free-use caveat. The left panel pairs the official UniWork mark with a small members–meetings–AI signal diagram; the right is a compact two-column ledger on paper, stacking on mobile. The diagram is decorative and makes no additional plan or limit claim. The homepage FAQ replaces its oversized question-mark art with an illustrative Tasks–Ask UNI–Documents network around the shared mark; the question cards retain their real answers and disclosure behavior. Existing section spacing and heading helpers remain local to each section. A short-desktop-height adjustment applies at heights up to 740px.

The shared closing frame centers the official mark, existing invitation and single registration action above a static task poster. It is at most 1400px wide with 32px / 20px / 12px minimum outer gutters at desktop / below 1024px / below 768px, a 32px top margin and 24px bottom margin. Top padding is 48px, reducing to 32px on mobile; copy gaps are 24px / 20px. The poster wrapper is at most 1180px wide with a 528px desktop height; below 1024px it is 380px high around a centered minimum-720px window, while mobile removes that minimum and fits the complete 1760×1000 desktop illustration to the available width with automatic height. The frame clips the poster at its lower edge. The current geometry is owned by `landing-closing.css`.

## Elevation & Depth

Depth combines tinted chapter stages, quiet separators and one bordered application window beside an unboxed feature selector; illustrative drawers, menus and dialogs carry local depth within the preview. The opaque floating header carries a soft navy-derived shadow at rest and a stronger one after scrolling; its feature directory uses a separate local shadow. Media crops use rounded clipping. The Solutions example window and roadmap graph have local elevation to distinguish them as visual demonstrations; selected audience and FAQ rows use bounded color-backed states. Security disclosures and provider labels stay quiet; the joined Starter offer receives one soft offset lift without an extra border. Work Products retains its restrained hover lift. The 3D core uses thin beveled porcelain/cobalt sheets, metallic seams, translucent frost, room-environment reflections and soft variance shadow maps. UNI retains its authored porcelain, blue/cyan mane and navy clothing exactly; a quiet circular light field and faint CSS shadow frame the original cutout. These media treatments do not redefine CSS surface chrome or add effects to the official logo.

### Shadow Vocabulary

- **Product workspace:** the unboxed feature selector sits outside one bordered application window; the inner navigation and content share that window without an extra shadow.
- **Illustrative overlays:** menus and dialogs use `--surface-shadow`; the task drawer uses a soft leftward shadow to explain its position above the list.
- **Navigation dock and directory:** local shadows mix `--landing-deep` with transparency; scrolling strengthens the dock's separation from moving content. The sidecar records their exact values.
- **Provider labels:** unboxed marks and text sit directly on the trust ground without a surface shadow.
- **Selected task:** an inset brand stroke (1px) marks selection independently of its tint.
- **Closing illustration:** a translucent rim and soft navy shadow lift the product poster from the gradient. The porcelain mark tile has a cyan inset and navy lift; the white registration action gains a small lift on hover. These remain local component treatments, recorded in the sidecar.

**The Product Plane Rule.** Keep the product selector and view in one elevated plane; reserve additional elevation inside it for local drawer, menu and dialog layers that explain an action. Ordinary content separates through tone, whitespace and quiet borders.

## Shapes

Controls and task rows use compact rounded corners; larger media use the broader frontmatter radii. The three Solutions selector rows have 18px bounded surfaces beside a 24px preview stage. Homepage FAQ answers have 13px bounded surfaces beside a 23px navy story panel; Security stays on straight quiet separators. Circular initials distinguish illustrative people and UNI. The floating header has 18px corners (14px on mobile), its feature directory has 16px corners, and navigation groups and the registration action use 10px corners. The hero action uses 12px corners and its context labels use 12px corners. These are scoped opening treatments, not additions to the global radius scale. Borders are quiet on content and stronger on outlined controls.

The product application window uses a 16px corner and a single border, while the external feature selector remains unboxed. Each illustrative action stage and dialog uses 12px corners, with 8px summary tiles, 10px storyboard task cards and member-picker corners, and compact 4–6px field, status and cursor-label details. Meeting participants, chat rail, Today panels and the static calendar use 12px corners. These are scoped preview proportions, not additions to the global card-radius scale.

Security icons are 20px cyan-tinted glyphs inside 56px-high disclosure targets, without separate plates. Homepage FAQ questions use 44px colored icon plates with 18px glyphs; the story uses a separate 50px emblem. Work Products retains its existing rounded paper icon plates. Starter uses the official UniWork mark in a 64px white plate; the gauge and quota checks use violet/mint plates. The example audit record keeps 16px corners; the joined pricing offer uses 22px desktop / 18px mobile corners. These are scoped landing components, not a new application-wide icon or corner scale.

Workflow icon objects have their own rounded geometry: 20px corners on 72px squares, changing to 16px on 56px squares on mobile. These proportions and their small cobalt shadow belong to the workflow illustration, not the global card radius or shadow vocabulary.

Starter and FAQ signal diagrams likewise use local illustration geometry: 20px/13px corners for Starter nodes and 24px/18px for the FAQ core at desktop/mobile sizes. These are not new UI card radii or control shapes.

The closing frame uses the existing presentation corners (36px / 28px / 24px). Its official mark sits in an 84px tile with 24px corners, reducing to 68px with 20px corners on mobile. The poster window has 20px upper corners and a 6px rim, reducing to 12px and 4px on mobile; inner clipping uses 14px / 8px corners. Its white action uses 12px corners. These are local composition exceptions, not additions to the global primitive radius scale.

## Components

### Buttons

Confident and compact. The hero has one brand conversion action with 24px horizontal padding, a 48px minimum height and a small cobalt shadow. Other sections retain brand and outline actions where their content needs them; the outline variant uses the input stroke and page background. Reusable studio actions use the frontmatter padding. Hover reduces brand opacity; active presses move by 1px. Outline hover uses the muted surface, with the registry's input-tinted treatment in dark mode. Global keyboard focus uses a 2px ring outline with 2px offset; header controls use a 3px offset.

Small secondary/ghost buttons switch board/list layout in the synthetic preview. Registry controls retain the 44px minimum touch target on coarse pointers.

### Chips

The roadmap label is a quiet bordered disclosure with compact text and a clock icon. It communicates availability, not an interactive filter. The preview's illustration marker serves the same disclosure purpose.

### Cards / Containers

Solutions uses three selectable audience rows with persistent routes and one replacing illustration: leaders see a concise work overview, product teams see task plus discussion, and operations see a three-step workflow. The preview renders the official shared lockup and synthetic local content; selection never mutates the authenticated app. The manual sandbox's task columns mix coral, cyan and lime with paper; hover and selection return to the stage tint, with an inset brand selection stroke. The Tasks storyboard uses a neutral summary and three columns of bordered cards with a paper/brand focused record. The product window uses a neutral top bar above a compact navy app rail and the active preview; one 16px border encloses the app, while the marketing selector remains separate. The audit example and joined plan/quotas offer use a single bounded frame each.

The new Solutions screen and roadmap graph are scaled illustrative media, not a new UI kit: their 9–13px micro labels, close-packed radii and local navy mixtures are internal composition detail. The adjacent selector and disclosures carry the readable, interactive content. Text in the illustrations does not establish a production type ramp or a released feature claim.

### Inputs / Fields

Search and chat use the shared Input primitive: semantic input stroke, rounded-lg corners, muted placeholder and a ring/border change on focus. Search paints the page background and filters the translated local task titles as the visitor types; the chat composer is 44px high. Inputs use 14px desktop text and 16px below 768px, with the existing 16px coarse-pointer safeguard. Empty chat cannot submit. Keep the field's real behavior and accessible label together.

### Navigation

The shared fixed header is an opaque paper dock, inset 20px from the sides and 12px from the top with a 1400px maximum width and 72px row. Below 768px it uses 12px side insets, a 10px top inset and a 62px row. The authentic shared brand lockup remains the home link. Navigation links use medium body text in the theme foreground; their group gains a soft-stage surface on hover or keyboard focus. Theme and language controls remain directly available.

At 1200px and above, Product, Solutions and Learn are labelled disclosure buttons; AI agents, Pricing and Enterprise are direct route links. The product directory has six columns and eighteen entries leading to `/features/[slug]`, plus an all-features link to `/features` and an explicit Watch demo link to `/#platform`. Solutions and Learn use three descriptive links with a directory footer. Their destinations include `/solutions`, `/learn`, `/learn#questions`, `/pricing`, `/enterprise` and the existing `/solutions/product`, `/solutions/operations` and `/why-uniwork` pages. AI agents in both header and footer leads to `/features/agents`. Below 1200px an expandable menu presents the three groups with native details/summary disclosures; below 768px the header sign-in and registration actions move inside it. Homepage demo anchors are reserved for explicitly labelled demo links in this navigation.

Both menus follow ordinary Tab order, close when keyboard focus leaves the header or on outside pointer input, and close after a navigation selection. ArrowDown opens a desktop directory and focuses its first link. Escape closes the active menu and restores focus to its trigger; crossing the 1200px breakpoint closes both. Controls retain visible focus and at least 44px touch footprints. The page also exposes a focus-revealed skip link. The directory and mobile menu arrive once over 180ms only when motion is allowed.

### Dedicated product introductions

Eighteen feature routes share a breadcrumb, unique promise, explanatory copy, registration action, explicit Watch demo action and existing availability notice. Each uses the corresponding fitted Lovable illustration or existing local playback scene, then three workflow benefits and up to three related feature links. The cyan-to-violet visual frame reuses semantic surfaces; the illustration's small internal labels remain media detail. It enters once over 600ms only when motion is allowed. Product facts, illustration labels and planned-feature caveats remain visible in Vietnamese and English.

The `/features` directory repeats the six product families as grouped route links. `/solutions` pairs audience copy with one illustration per row. `/learn` provides three linked steps and a reusable FAQ, initially five of ten questions, with aligned semantic icons/chevrons and a show-more/show-fewer control at least 44px high. Its shell loads the shared FAQ styles before page-specific alignment. `/pricing` reuses the existing single Starter offer and caveats; `/enterprise` introduces organization and audit context without claiming a released enterprise package. These pages add browsing structure, not new product availability or a replacement visual identity.

### Closing invitation

The shared Final CTA follows the supplied ClickUp composition within Bright Studio: an official Logo mark, the unchanged centered invitation in white, one white action to `/register`, and a visibly labelled static task poster on the blue-violet field with cyan bottom light. It appears on the homepage, existing Solutions/Why pages and at the end of every `MarketingShell` page. The poster reuses the original 1760×1000 Lovable task UI in its completed state, with inert illustration content and an accessible sample-data label. It has no playback controls or expansion dialog and makes no native-phone or released-app claim. Its shared preview tokens follow the page theme; the closing gradient slots remain constant in both modes.

The registration action is at least 52px high, uses 600 weight and lifts 2px over 200ms on hover; keyboard focus has a 2px white outline with 5px offset. Reduced motion removes its transition and hover translation. The logo and product poster are static; the homepage's existing section-reveal treatment remains separate from the illustration.

### Brand anchor

The hero renders the official shared `Logo` as a stationary DOM overlay above supporting 3D geometry. The horse wears the authentic mono mark as a fixed DOM layer on its original navy shirt; the raster contains no generated imitation. Preserve normal proportions, orientation and clear space. The product film's top bar uses the complete shared lockup, not manually typed wordmark text.

**The Brand Anchor Rule.** Render identity through the shared Logo component. Supporting work objects move around the stable hero mark; the horse's shirt mark stays fixed and undeformed.

### Unified product workspace

One registry defines eighteen entries across the six product families: ten demo illustrations, one partial and seven planned. Dashboard is an additional illustration, not a new develop availability claim. The external selector controls one visible panel and hash; its active family uses vertical keyboard semantics on desktop and horizontal semantics at ≤900px. Watch mode contains a full, inert application illustration. Manual mode retains the existing six-button Home/Work/Connect/Docs/AI/Team rail and shared local state.

Five local storyboards remain: Tasks assigns UW-102 to Hoàng Anh, then separately selects done and moves the same card, updating column counts, summary and Project Copilot together (3→4 done, 9→8 in progress, 64 total). Meetings depicts the labelled simulated source picker and explicit share confirmation; switching to its static meeting list suspends playback. Chat shows form confirmation and pending creation before a linked task. Email opens and stars a synthetic thread. Ask UNI now uses the observed AI Assistant page with tabs, prompt cards, conversation and assistant catalog; its deterministic cited answer opens an illustrated source detail. None uses a live AI/business API. Tasks has seven beats, Chat five and the others four, at 2.6 seconds per beat.

A decorative named cursor measures control bounds with scale compensation, including after expansion/remount. It travels over 650ms with the shared Logo, human actor and localized action. A 200ms press, 360ms ring and target outline lead the next state by 240ms. FLIP movement lasts 680ms; pausing preserves remaining time and resetting is instantaneous. Five films and thirteen static reference views all support watch/explore. Illustration DOM is inert inside a labelled image; feature selection, expansion and playback are unscaled real controls outside it. The toolbar retains the sample-data label. The repeated bottom availability strip and design-note footer are removed; manual concept views retain their own roadmap/configuration notices.

“Tự khám phá” / “Explore yourself” switches to the existing local controls. Manual panels remain mounted while hidden so selections, microphone simulation, search and starred messages survive watch/explore and tab changes. The film has separate state and never mutates the manual examples. Tasks supports search, board/list switching, selection, completion and reopening. Chat accepts local messages and creates an example task in the same board; its task link selects that record. Email has selectable threads and working stars. Today places personal tasks beside the inbox and an agenda below them, stacking at widths up to 1100px. Its counts, task status and assignee labels read the same mutable task records, including completion, reopening and global reset; its task/meeting links and inbox read/reset action remain usable. Ask UNI provides deterministic read-only answers and source navigation, not live AI calls.

Manual Projects, Organization and Audit retain their existing synthetic state and scope examples. Seven concept entries retain roadmap notices in manual mode. Their watch views use static Lovable-inspired layouts for calendar, workflow, outputs, documents, approvals, knowledge and automation. People Directory and Agent Builder follow observed source topology. Illustrated controls cannot execute. The shared Logo remains authoritative; screenshots do not establish deployed Dashboard, AI Copilot or automation availability. Source boundaries remain in `../../docs/landing-develop-sync.md`.

In manual mode, Meetings contains the local room controls; its conditional after-meeting workflow film is available in a disclosure. No device permission is requested and no real media is captured. One labelled reset icon in the manual topbar clears every local example, including child state. All records are synthetic and in memory; no business API is called. Status, priority and role values remain lowercase English in both locales under `../../docs/conventions.md`.

Only the visible film advances. The controller preserves beat/click delays while paused, offscreen, document-hidden or on the meeting list. Reduced motion starts paused and removes the pointer and spatial effects; explicit playback still exposes all states. The visible director, step captions and progress strip are removed. The changing scene retains its accessible image label; pause/play shares the existing preview toolbar with Expand. Watch views share a 1760×1000 canvas with a 260px sidebar, 72px toolbar and optional 270px AI rail (400px for document collaboration). ResizeObserver scales it uniformly without hiding columns, while real controls stay normal-sized. Expand opens an accessible dialog with fit/detail modes; detail scrolls locally at a minimum 1200px canvas width. Watch mode removes legacy body minimum heights. `lovable-frame.tsx`, `lovable-overviews.tsx`, `lovable-reference.tsx`, `lovable-secondary.tsx` and `landing-lovable.css` own reference geometry. Existing playback and action-motion modules retain sequencing and FLIP behavior.

Feature selection updates the hash without moving the viewport. Initial links to `#du-an`, `#hop`, `#trao-doi`, `#email`, `#hoi-uni` and `#daily-tools` open the corresponding view within `#platform`; `#nhan-su-ai` remains the horse story. Cross-panel task/source actions move keyboard focus to the selected tab. Today and Projects links explicitly enter the destination's manual panel, preserving the example's task state rather than restarting a film. `landing-workspace.css` owns the preview content and `landing-dual-navigation.css` defines the two-layer shell; meeting and email styles only describe their inner preview.

**The One Product Stage Rule.** Within the homepage sandbox, explain each app capability inside one shared workspace and one visible panel. A marketing feature selector and an illustrated app navigation rail may both control that same stage; do not duplicate sandbox preview sections or add redundant top feature tabs. Dedicated introductions reuse the relevant illustration on their own route.

### Compact provider band

Quiet and informational. The homepage TrustBand presents the existing model-choice heading with Anthropic, OpenAI and self-hosted provider labels directly on the navy trust ground. Original vendored marks use 22px artwork inside transparent 28px footprints; provider names use theme foreground. Horizontal section rules frame the band, while provider cards, connecting rail and the repeated guarantee ledger are absent. The labels remain list items, with no hover, selected, pressed or navigation behavior. These compact metrics are scoped to the homepage chapter, not standalone uses.

Governance detail lives in Security's three grouped disclosures (six preserved facts) and a visibly labelled sample audit record above the band. The sample pairs actor and time with an assignment before/after, workspace scope and trace context, and the adjacent link opens the audit preview. This is illustrative content, not live operational evidence.

The TrustBand's content follows the quieter supporting-section scroll settle. Provider labels do not animate independently with blur or stagger. Reduced motion leaves the complete content static; there is no continuing signal loop or interactive model selection in this band.

**The Provider Label Rule.** On the public landing TrustBand, present original provider marks and names as a compact noninteractive band; never imply an endorsement or selectable card.

### Progressive disclosure

AI benefits, security mechanisms, WorkProducts and roadmap phases use the shared Accordion primitive. Labels remain visible; supporting facts and caveats stay accessible within disclosures, while roadmap notices remain outside them. AI and Security keep quiet separators; the redesigned roadmap and homepage FAQ use colored bounded disclosures with distinct hover/open states. Work Products remains explicitly future-facing. The registry's chevron and keyboard-focus treatment still carry the disclosure behavior. The home FAQ initially shows five of ten questions, with a labelled show-more/show-fewer control for the remainder. This is a landing-page density choice, not a new rule for authenticated product screens.

### Semantic icon anchors

Recognizable before the label is read. FAQ, Security, Work Products and Pricing use semantic outlined icons with restrained functional color. Security keeps transparent alignment footprints; the homepage FAQ, Work Products and Starter use local colored plates. Icons are hidden from assistive technology when the adjacent text supplies their meaning.

- **Security:** three 20px cyan-tinted glyphs identify Access & AI, Change history, and Usage & privacy inside 56px-high targets. The redundant shield and organization/workspace badges remain removed. Rows use quiet separators, stay stationary on hover and gain a restrained tint when hovered or open; keyboard focus remains visible.
- **Work Products:** four 52px paper icon plates reduce to 48px on mobile, with 25px glyphs. Cyan, violet, coral and lime modules distinguish their subjects; a 3px hover lift and stronger hover/open borders expose interactivity. Existing roadmap notices remain outside the disclosures.
- **Pricing:** the Starter plan uses the official 36px UniWork mark in a 64px white plate on navy; the adjacent three-node signal diagram uses outlined semantic icons. The quota heading uses a 44px violet plate with a 22px gauge glyph. Eight quota checks alternate existing violet, mint and cyan plate tokens with 15px glyphs, not independent actions.
- **FAQ:** all ten questions keep semantic glyphs; the homepage places 18px glyphs in 44px tinted plates, with bordered answer rows and a navy story panel containing the shared mark and a three-topic signal diagram. Other pages retain the reusable accordion behavior. Answers align with the text after the icon.

These state transitions use the existing 200ms rhythm and landing reduced-motion override. The redesigned three chapters add one-shot, staggered child arrivals only after their section scroll reveal becomes ready; selection changes only the adjacent illustrative preview.

**The Semantic Icon Anchor Rule.** On the public landing's FAQ, Security, Work Products and Pricing sections, use consistent outlined geometry and functional color roles; preserve each section's local footprint or plate treatment and the shared disclosure focus and chevron behavior.

### Three illustrative media

- **Live work core:** original procedural Three.js geometry with a porcelain medallion, thin detailed task/chat/context objects, fine connecting rails and traveling signals. Four noninteractive context labels name Tasks, Chat, Meetings and Ask UNI around this same core. It remains supportive media, with one subdued 44px pause/play control over the artwork, placed clear of the context labels. The caption and separate footer are removed. Direct dragging and tile emphasis remain optional visual interactions; they do not navigate the product. The official mark and its front-facing support remain stable. Separate rotate and mode controls are removed.
- **UNI horse:** the exact approved `uni-horse-v2.webp` artwork, with its original face, expressive eyes, sculpted cobalt/cyan mane and tail, body proportions and navy clothing. The official mono Logo stays on the shirt as a DOM overlay at 42.8% / 62.5% of the centered square image plane. Canvas and logo share the untransformed layout dimensions (`clientWidth` / `clientHeight`); canvas sizing never writes inline CSS dimensions, preventing drift during scroll-reveal scaling or resize. A bounded foreleg mask produces one 2.4-second welcome wave; the mask excludes all face and mane vertices. It then settles permanently for that mount, with no pause control or greeting strip. Reduced motion leaves the original pose still. The face, body and tail remain unchanged, with no replacement blink image or synthetic relighting. This is restrained 2.5D animation of the approved artwork, not a reconstructed 3D character.
- **Workflow film:** a silent, looping, code-authored 3D illustration rendered locally with Remotion ThreeCanvas and Three.js. Detailed meeting objects gather into a shared-context stack, then unfold into linked task sheets; fine connections carry signals between them. It is 7 seconds, 960×640, 30fps and 210 frames, with an H.264 MP4 and WebP poster. It contains no logo or invented identity and is not generative-model video. Three chapter controls seek within it; playback can be paused or resumed.

The core and horse renderers initialize near the viewport, cap pixel ratio at 1.5 and suspend their animation loop while offscreen or document-hidden. Reduced motion starts both still. The core retains manual pause/play and optional direct manipulation; essential product interactions live in the accessible sandbox controls. The horse has no controls: its single short wave automatically releases the animation loop on completion and does not restart on re-entry. The film uses `preload="none"`, starts automatically only when visible and motion is allowed, pauses offscreen or in a hidden document, and allows explicit playback under reduced motion.

The core preserves its official Logo and loading/error text without GPU rendering; its motion control disables on failure. The sandbox stays independently usable. The horse keeps the same transparent static image available before rendering and on GPU failure; if that image also fails, the shared mark and fallback message remain. The film uses its authored poster and the original team-session illustration on error.

The two horse WebPs are 1200×1200 with alpha: `uni-horse-v2.webp` is 190,390 bytes and is both the active texture and loading/WebGL-failure fallback; the historical `uni-horse-v2-blink.webp` is 168,304 bytes and is no longer loaded. Exact prompts, generation method, checksums and masters remain preserved beside the public assets and under `../../scripts/landing-mascot`. `prepare-v2.mjs` reproduces optimization. Film assets and provenance are unchanged.

**The Controlled Motion Rule.** Automatic motion respects reduced-motion preferences, visibility and explicit pause; essential product interaction remains in accessible controls outside animated imagery.

Starter and homepage FAQ add fine dashed signal travel and subtle node/core motion. Each CSS animation is a single short pass (at most 4.5 seconds), runs only while its section intersects the viewport and the document is visible, and is removed entirely under reduced motion. The Starter quota rows arrive once with a short vertical stagger after scroll reveal, without lowering text opacity. FAQ cards respond to hover/open state, while the shared Accordion keeps its keyboard and focus contract. This is illustrative landing motion, not simulated live product activity.

Most hover transitions last 200ms. The opening copy and work-core composition have finite 650ms and 900ms entrances from 16px below at 0.65 opacity; navigation menu entrances last 180ms from 5px above at the same starting opacity. These opening animations and navigation hover transitions only run under `prefers-reduced-motion: no-preference`; reduced motion also removes the dock-shadow and disclosure-chevron transitions. This leaves the original core pause, visibility and reduced-motion behavior intact. Unified workspace panels enter over 240ms with a 6px rise and a light opacity settle; reduced motion disables the transition. Selection responds immediately and does not scroll or animate the entire page.

Six large frames (workspace, horse, trust, future, pricing and closing) expand from 0.94 scale and 40px below to their final geometry while their top moves from 98% to 54% of the viewport, with 0.35s scrub smoothing. On mobile this is reduced to 0.975 scale and 18px. The focal horse enters independently from 0.88 scale and 64px below (24px on mobile) over the 96%→38% interval with 0.45s smoothing.

Supporting content arrives once when its section enters at 88% of viewport height: 28px desktop/18px mobile translation and opacity resolve over 700ms with power3.out easing. It remains fully visible after leaving and returning; stopping the wheel does not strand text half-transparent. Keyboard focus finishes an entrance immediately. CSS defaults are visible without JavaScript, and reduced motion removes scroll effects.

There is no scroll hijacking, pinning, page-edge signal or new page-wide loop. Reduced motion reverts scroll transforms and opacity, starts media paused and still permits explicit playback. ResizeObserver refreshes trigger positions after disclosure, locale or media height changes. This choreography is local to the public landing.

## Do's and Don'ts

### Do:

- Do use the shared semantic color slots in both themes.
- Do retain visible keyboard focus, usable touch targets and reduced-motion behavior.
- Do keep essential product actions in the sandbox controls and media playback controls keyboard reachable.
- Do keep synthetic demo content, illustrative artwork and roadmap capabilities visibly identified.
- Do preserve Vietnamese and English parity and complete diacritic coverage.
- Do render the official shared Logo separately from generated imagery, with unchanged proportions and orientation.

### Don't:

- Don't apply this marketing typography and composition to the authenticated app shell.
- Don't present preview rows, generated artwork or provider marks as customer or usage evidence.
- Don't imply that WorkProducts or autonomous agent actions are shipped capabilities.
- Don't replace the actual brand mark with a generated approximation.
- Don't redraw or replace the approved horse with a procedural approximation; do not describe its 2.5D image animation as a matching 3D reconstruction.

## Landing V2 refinement — 2026-09-24

These scoped rules supersede the earlier landing roadmap, mobile canvas and quota-check descriptions above. The approved studio, typography, hero, mascot, trust chapter and closing artwork remain the incumbent world.

- Product storytelling follows the owner-approved Lovable reference. A preview label describes **interactive sample** versus **illustration**, not production readiness. Configuration, access and commercial terms have a separate compact readiness section. Never equate a visible demo control with a verified backend capability.
- Twenty-five introduction routes include AI Brain, Skill Hub, Work Catalog, decision review/history, AI Market and reports. Navigation-only evidence gets a content overview, not fabricated operational controls. No copied customer evidence, marketplace prices or invented integrations.
- The four-step connected-work story replaces disconnected feature claims with meeting → proposal → ownership → version-specific review. Its selected result changes with a short 240ms transition; reduced motion is still. It never auto-approves work.
- Dedicated feature pages include a three-step workflow explanation and two disclosures: a group-specific practical question and the reference/deployment boundary. Readiness and Learn provide concrete setup guidance, not repeated marketing links alone.
- Below 768px, instructional previews become an explicitly labelled focused summary with 16px body copy and 44px controls. Desktop application geometry remains intact above that breakpoint. Decorative closing posters are exempt: they remain noninteractive artwork. Expanded mobile previews must not require two-axis scrolling, and hidden desktop films must not keep advancing.
- Starter uses a compact horizontal offer: official mark and plan identity, restrained price, then registration. Its provisional terms stay visible; a keyboard-operable disclosure holds the eight metering categories, scope note and setup guidance. No tall promotional price column, decorative pricing diagram or included-benefit checkmarks. Below 768px, the action becomes a full-width second row. The deployment-contact destination remains intentionally unset.
- In desktop watch mode (>900px), the fitted application determines the demo row height. Size containment makes the feature selector scroll independently instead of stretching the application frame into a blank lower strip. Mobile keeps the selector in normal document flow.
- All new prose has Vietnamese/English parity. Server metadata follows the request locale and refreshes when the visitor changes language. Schema status values remain untranslated by convention.

Refinement evidence: the prior 2026-09-24 landing critique, direct demo observations recorded in `docs/landing-develop-sync.md`, and desktop/mobile browser verification. No raster assets or brand geometry were changed in this revision.
