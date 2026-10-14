---
name: UniWork
description: A vivid, dense and scannable work system with precise, semantic UI.
colors:
  primary: "#0a52e6"
  primary-foreground: "#ffffff"
  primary-dark: "#5a96ff"
  primary-foreground-dark: "#0d1220"
  brand-subtle: "#e4edff"
  brand-subtle-dark: "#222e42"
  brand-accent: "oklch(0.58 0.27 325)"
  brand-accent-dark: "oklch(0.70 0.22 325)"
  background: "#ffffff"
  background-dark: "#111111"
  foreground: "#202020"
  foreground-dark: "#f8f9fa"
  app-shell: "#f4f4f5"
  app-shell-dark: "#0a0a0a"
  surface: "#ffffff"
  surface-dark: "#181818"
  surface-hover: "#f4f4f5"
  surface-hover-dark: "#262626"
  muted-foreground: "#646464"
  muted-foreground-dark: "#a1a1aa"
  border: "#e4e4e7"
  border-dark: "#2e2e2e"
  input: "#87878f"
  input-dark: "#707078"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "36px"
    lineHeight: "40px"
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Plus Jakarta Sans, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    lineHeight: "24px"
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: "20px"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    lineHeight: "18px"
  overline:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: "16px"
    letterSpacing: "0.08em"
  marketing:
    fontFamily: "Be Vietnam Pro, sans-serif"
rounded:
  sm: "6px"
  md: "8px"
  control: "10px"
  lg: "12px"
  xl: "16px"
  2xl: "20px"
  3xl: "32px"
spacing:
  2: "8px"
  3: "12px"
  4: "16px"
  6: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  button-primary-dark:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.primary-foreground-dark}"
    rounded: "{rounded.control}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  input:
    rounded: "{rounded.control}"
    padding: "4px 10px"
    height: "32px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: UniWork

## Overview

**Creative North Star: "Legibility at a glance"** — the established product principle in [PRODUCT.md](PRODUCT.md).

Work screens are dense and scannable; decision screens have more space. Aligned type, grouped information and meaningful color establish hierarchy. The public site extends the same identity through Be Vietnam Pro, blue actions and product imagery.

This is a snapshot of the incumbent system on 2026-10-14, not a new visual direction. [packages/ui/styles/tokens.css](packages/ui/styles/tokens.css) remains the implementation source. Frontmatter records its default UniWork accent in light and dark modes; the existing accent axis may change brand slots at runtime. Page compositions belong in their surface records, including [Office B](docs/office/landing-design.md).

**Key Characteristics:** semantic color; compact controls; clear type roles; both themes; factual content.

## Colors

### Primary

UniWork blue identifies the main action, selection, focus and brand entry points. Primary and brand fills share the same runtime value. The dark fill uses its dark foreground pair; retain that pairing when composing controls. The brand wash carries selection without the weight of a solid action.

### Secondary

The existing magenta brand accent is a text/icon accent. It has no foreground pair for a filled surface.

### Neutral

The app shell is the deepest plane. Sidebar and page share the canvas plane; content surfaces and floating layers build above it. Foreground, muted foreground and faint foreground have different jobs: faint foreground is for non-text marks. Hairline borders separate content; the stronger input token defines controls.

**The Semantic Color Rule.** Module tints identify a module or category; signals report state. Read module assignments from [module-tones.ts](packages/views/layout/module-tones.ts), and use each tint/signal's fill and foreground pair from the token source. Preserve the established success, warning, info and destructive families rather than substituting brand color.

## Typography

App headings use Plus Jakarta Sans, copy and controls use Inter, and taxonomy overlines use JetBrains Mono. Public marketing surfaces bind their body and heading voices to Be Vietnam Pro through [landing-font.ts](apps/web/platform/landing-font.ts) and [landing.css](apps/web/features/landing/landing.css), with English and Vietnamese coverage.

Use the existing role scale: micro/caption/label, body/body-lg, title-sm/title/title-lg, display-sm/display and hero-sm through hero-xl. Weight is chosen by the component; the size role does not impose it. Overlines are the established uppercase mono role. Keep typed input text in the sans family with normal tracking.

## Layout

Density follows the work: lists and boards group compact records; settings, onboarding and dialogs leave room for decisions. The existing component rhythm commonly uses the recorded spacing steps, with smaller gaps inside controls. Coarse pointer targets are at least (44px), and text inputs use (16px) to prevent mobile focus zoom.

Public feature chapters use a centered container (1360px) with (32px) desktop gutters, as defined in [marketing-pages.css](apps/web/features/landing/marketing-pages.css). Their responsive changes remain scoped to the surface. Office B's centered product stage is recorded separately.

## Elevation & Depth

Borders and tonal planes do most of the work. The existing surface, menu and floating shadow tokens add progressively stronger depth and resolve separately in both themes; their exact values live in the [design sidecar](.impeccable/design.json). Use the raised plane for a floating control and the appropriate shadow rather than introducing a new shadow recipe.

Motion uses the incumbent duration and easing tokens. State changes explain what happened, and reduced motion remains supported. The sidecar records the existing timing vocabulary, including the distinct settle duration.

## Shapes

The radius scale runs from compact controls through cards, menus, panels and section media. Pills use a full radius. Choose the existing component's shape before applying a local override. Office B's current frame geometry is recorded in its surface record; A's earlier stage contour is historical.

## Components

### Buttons

Use the registry's default, brand, outline, toolbar, brandSubtle, secondary, ghost, destructive and link variants. Standard controls use the control radius. Outline buttons use the input edge, while toolbar buttons use a soft contextual fill. Preserve hover, active, expanded, disabled and invalid states. Navigation stays an anchor even when button styling is applied.

### Inputs / Fields

Use the registry default or subtle variant. The input edge identifies the resting field; focus uses the ring token. Invalid state includes explicit text and the destructive treatment. Disabled styling and mobile input sizing are already part of the primitive.

### Chips

The badge primitive is compact and pill shaped; use its semantic variants. Brand and brandSubtle button states serve active controls. State must be expressed in the label or interaction semantics as well as color.

### Cards / Containers

The card primitive uses the surface pair, surface border, low surface shadow and large radius. Its default assembled padding is the recorded card padding; the small variant uses (12px). Use semantic surface layers to group real content.

### Navigation

Workspace navigation groups work by behavior and uses canonical module glyphs and tints. Public navigation uses grouped route destinations, preferences and account actions, with mobile disclosures at its own breakpoint. Use the existing controls and preserve keyboard operation, visible focus and the skip link.

## Do's and Don'ts

- **Do** use semantic colors, role sizes and existing registry controls.
- **Do** verify contrast, keyboard interaction and content in both themes and both shipped languages.
- **Do** use actual product captures and label illustrative sample content.
- **Don't** invent customers, metrics, availability, AI output or content for an empty state.
- **Don't** use decorative gradient chrome, glassmorphism or AI theatrics.
- **Don't** turn a page's composition or scoped geometry into a system-wide rule.
