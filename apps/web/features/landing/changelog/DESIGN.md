---
name: UniWork Public Changelog
description: Chronological release reading within UniWork's existing Bright Studio public shell.
colors:
  brand: "#0a52e6"
  brand-dark: "#5a96ff"
  background: "#ffffff"
  background-dark: "#111111"
  foreground: "#202020"
  foreground-dark: "#f8f9fa"
  muted-foreground: "#646464"
  muted-foreground-dark: "#a1a1aa"
  border: "#e4e4e7"
  border-dark: "#2e2e2e"
  muted: "#f4f4f5"
  muted-dark: "#262626"
typography:
  display:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "48px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  display-mobile:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "clamp(1.625rem, 2.7vw, 2.125rem)"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.85
  body-list:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.9
  label:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "0.875rem"
    lineHeight: 1.5
  metadata:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "0.8125rem"
    lineHeight: 1.6
  month:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  sm: "6px"
  control: "10px"
  timeline-dot: "50%"
spacing:
  compact: "12px"
  related: "14px"
  content: "20px"
  group: "28px"
  section: "36px"
  chapter: "64px"
components:
  button-copy:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    size: "32px"
  button-copy-hover:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
  release-index:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label}"
    padding: "8px 0"
    width: "190px"
  release-index-current:
    textColor: "{colors.brand}"
    typography: "{typography.label}"
  release-metadata:
    typography: "{typography.metadata}"
  release-body:
    typography: "{typography.body}"
    width: "min(100%, 760px)"
  update-group:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body-list}"
  explore-link:
    textColor: "{colors.brand}"
    typography: "{typography.label}"
    height: "36px"
---

# Design System: UniWork Public Changelog

## Overview

**Creative North Star: "Bright Studio"**

The changelog is the reading expression of UniWork's existing public world: Be Vietnam Pro, the official logo, a quiet neutral ground and scarce cobalt signals. The shared public header and footer retain their identity and behavior; release content uses a flat chronological column rather than the homepage's illustrative scenes.

This document applies only to `features/landing/changelog`. It records the shipped `uniwork-changelog` boundary and inherits the public shell documented in `../../../DESIGN.md`; it does not establish another brand or change authenticated UI. The user-pinned Multica reference supplies chronology, while UniWork's code supplies the visual values. Runtime tokens in `packages/ui/styles/tokens.css` are authoritative when an older document differs.

**Key Characteristics:**

- One family supports Vietnamese and English with weight and leading as hierarchy.
- Neutral release prose, cobalt current-location signals and quiet hairline separators.
- Month/version navigation and the release feed share one catalogue.
- A sticky desktop index becomes compact navigation in the mobile reading flow.
- Stable release anchors and the shared copy control provide direct access.

Extraction sources: `page.tsx`, `changelog.css`, `../landing.css`, `../layout-primitives.tsx`, `platform/landing-font.ts`, the shared Button, `packages/ui/styles/tokens.css` and `base.css`. Reviewed desktop/mobile captures in both themes corroborate the implementation. Release publishing and approved metadata remain in `docs/public-changelog.md` and `packages/core/changelog/releases.json`.

## Colors

The page keeps the shared neutral palette and uses cobalt as a navigational signal.

### Primary

- **Cobalt Ink / Bright Cobalt:** the `brand` pair marks the current version, its timeline dot, the Latest label and the feature link. The Latest label is plain text, without a filled badge.

### Neutral

- **Reading Paper / Night Ground:** the `background` pair supplies the continuous reading surface and unselected timeline dots.
- **Reading Ink:** the `foreground` pair supplies page/release headings, version labels and the copy icon.
- **Secondary Ink:** the `muted-foreground` pair supplies summaries, update prose, dates, months and inactive index links.
- **Quiet Divider:** the `border` pair separates release entries, publisher notes and the compact mobile index.
- **Control Wash:** the `muted` pair belongs to the shared ghost button's hover state; its dark hover uses a half-opacity wash.

Unsuffixed frontmatter values record light mode; `-dark` values record the matching dark slot. Runtime code reads the unsuffixed semantic CSS property. Focus reads `--ring`, which currently matches brand in both themes.

**The Shared Theme Rule.** Read colors from the shared semantic slots so release prose and controls change together with the public shell.

## Typography

**Display Font:** Be Vietnam Pro (sans-serif fallback).
**Body Font:** Be Vietnam Pro (sans-serif fallback).

One family carries the entire reading surface. Semibold headings distinguish page, release and update-group levels; ordinary prose stays calm and loosely led. Version days use tabular numerals, without introducing a monospace face.

### Hierarchy

- **Display:** `display` leads the page; `display-mobile` applies at the compact-index breakpoint.
- **Headline:** `headline` is the fluid release title, limited to 30ch.
- **Title:** `title` names Features, Improvements and Fixes.
- **Body:** `body` is the release summary, limited to 70ch. The introductory description uses the same size with slightly tighter leading (1.75).
- **Body list:** `body-list` gives update bullets comfortable reading rhythm.
- **Label / Metadata / Month:** `label` supports index navigation, `metadata` supports version/date rows, and `month` names chronological groups. Index headings/current links are semibold; the feature link is medium weight.

**The Single Reading Face Rule.** Keep Be Vietnam Pro for public release headings, prose and controls; use hierarchy rather than another display family.

## Layout

The shared public Container supplies the outer maximum width (80rem), centered alignment and responsive gutters (1rem, then 1.5rem from 640px). The changelog grid centers a narrow index (190px) beside a reading column capped at 760px, with a fluid gap (clamp(40px, 7vw, 100px)). The introduction and feed align to the same second column.

Desktop content clears the fixed header with top padding (172px). The index stays beneath it (top: 132px), limits its height to the viewport and scrolls independently when needed. Anchor targets inherit the public shell's scroll clearance (100px). The introduction leaves a generous chapter gap before the feed; groups use the recorded section rhythm and separated releases receive a hairline plus breathing room (80px outer gap, 72px inner padding).

At 800px and below, the page becomes one column: title, compact wrapping index, then release feed. The index loses stickiness and height limits; a bottom divider separates wayfinding from prose. Top/bottom page padding reduces (132px / 64px), and update-group spacing uses `group`. On coarse pointers, index and feature links have a minimum target height (44px).

**The Index In Flow Rule.** Below the changelog breakpoint, place the complete month/version index before the release feed so wayfinding remains available in reading order.

## Elevation & Depth

The owned reading surface is flat: no release cards or content shadows. Whitespace, weight and hairlines supply separation. The shared header keeps its existing floating-shell elevation; that treatment is not promoted to release content.

**The Flat Reading Rule.** Separate release prose with space and quiet dividers rather than raised containers.

## Shapes

Release articles remain open on the page ground. Circular timeline dots use `timeline-dot`; the small link focus treatment uses `sm`; the shared copy button uses `control`. Borders serve the timeline rail and content dividers, without enclosing each update in a box.

## Components

### Copy button

The shared ghost icon button sits at the trailing edge of each version/date row. It uses the existing link/check SVG icons, a transparent resting surface and Control Wash on hover. Keyboard focus inherits the shared outline (2px, 2px offset); coarse-pointer sizing expands the control to at least 44px.

Copying writes the release permalink and replaces the link icon with a check. A polite live status reports success or clipboard failure; successful feedback resets after 2.5 seconds. This is state feedback, with no release-content entrance animation.

### Release index

Month headings precede version links along a thin vertical rail. A current link has cobalt text, semibold weight and a filled cobalt dot; inactive links use Secondary Ink and a hollow dot. Hover turns the label cobalt. Keyboard focus uses the theme ring (2px, 4px offset). The selected location follows valid hashes and visible release articles and is exposed through `aria-current="location"`.

### Release article and update groups

Each article owns a stable id and an accessible title. Its metadata row wraps as needed, retaining version, localized date, a plain Latest label on the newest item and copy control. The title leads into a summary, then the catalogue's Features / Improvements / Fixes groups. Bullets use disc markers, small internal gaps and loose leading; the publisher note ends the article behind a divider.

The shared catalogue sorts newest first and supplies both navigation and articles. The current approved entry is v1.0.0; its title, date and item count are release facts, not design tokens. No earlier entries are synthesized to fill the timeline.

### Feature link

A quiet cobalt text link with an inline arrow follows the publisher note. It keeps its own keyboard indicator and coarse-pointer target sizing, then opens the existing feature introduction.

## Do's and Don'ts

### Do:

- **Do** keep the official public identity, Be Vietnam Pro and shared theme slots.
- **Do** distinguish the current release through text weight, color and its timeline dot.
- **Do** preserve month/version wayfinding above the feed on compact screens.
- **Do** give copy actions visible feedback and a polite live status.

### Don't:

- **Don't** turn release prose into elevated cards or competing filled panels.
- **Don't** hide release notes behind entrance animation or disclosure.
- **Don't** import the reference site's branding or typography into this UniWork boundary.
