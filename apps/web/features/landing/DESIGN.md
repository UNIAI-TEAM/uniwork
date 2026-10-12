---
name: "UNI Architectural Studio 02 — DRAFT"
description: "Scoped record of the UNI-1334 studio candidate; not approved for shipping."
colors:
  brand: "#0a52e6"
  brand-dark: "#5a96ff"
  brand-foreground: "#ffffff"
  brand-foreground-dark: "#0d1220"
  brand-accent: "oklch(0.58 0.27 325)"
  brand-accent-dark: "oklch(0.70 0.22 325)"
  background: "#ffffff"
  background-dark: "#111111"
  foreground: "#202020"
  foreground-dark: "#f8f9fa"
  muted-foreground: "#646464"
  muted-foreground-dark: "#a1a1aa"
  border: "#e4e4e7"
  border-dark: "#2e2e2e"
  landing-stage: "#edf2ff"
  landing-stage-dark: "#192741"
  landing-model-shell: "#f4f7ff"
  landing-deep: "#101f42"
  landing-close-light: "#15aede"
typography:
  display:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "clamp(48px, 4.8vw, 76px)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "16px"
  description:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "18px"
    lineHeight: 1.8
  navigation:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "14px"
    fontWeight: 500
rounded:
  control: "10px"
  action: "12px"
  dock: "18px"
  copy: "24px"
  story: "32px"
spacing:
  gap-sm: "12px"
  gap-md: "24px"
  copy-padding: "28px"
  chapter-padding: "100px"
components:
  primary-action:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-foreground}"
    rounded: "{rounded.action}"
    height: "48px"
    padding: "0 24px"
  motion-control:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    height: "44px"
    width: "44px"
  copy-surface:
    backgroundColor: "color-mix(in srgb, var(--background) 96%, transparent)"
    rounded: "{rounded.copy}"
    padding: "{spacing.copy-padding}"
  story-surface:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.story}"
  navigation-dock:
    backgroundColor: "var(--landing-paper, var(--background))"
    rounded: "{rounded.dock}"
    height: "72px"
    padding: "0 22px"
---

# Design System: UNI Architectural Studio 02

> **DRAFT / NOT APPROVED FOR SHIPPING**
>
> Latest finish disposition: **REBUILD**, after valid native-scroll evidence.
> Functional checks passing do not constitute a visual or cinematic pass.
> This document describes the built candidate; it does not approve its focal
> character, composition, lighting or action finish.

## Overview

**Creative North Star: "UNI Architectural Studio 02"**

The user explicitly chose the architectural studio, option 02 of the generated
triptych. The requested expression is a dimensional world that fills the page,
with UNI running and jumping through architecture as native scroll changes the
pose and camera. The confirmed choice identifier is **UNI-1334-studio-02**. It
records that user choice; it is not a generated seed, catalog quality bar or
approval of this implementation.

This scope is the public landing feature. It records the actual scene in
[landing-page.tsx](landing-page.tsx), [cinematic-world.tsx](cinematic-world.tsx)
and [studio-world.ts](animation/studio-world.ts), together with the inherited
landing UI. The existing [web design record](../../DESIGN.md) remains the
incumbent reference for other public surfaces. No rule here extends to the
authenticated work interface. Product content remains readable, truthful and
available without the animated illustration; English and Vietnamese retain
parity.

The current runtime is a source-authored studio and articulated UNI candidate.
The original [UNI horse artwork](../../public/landing/mascot/uni-horse-v2.webp)
remains the likeness authority. A finished production model and rig have not
been integrated; asset availability is unresolved. The required model, clips,
budgets and acceptance work are described in the
[production asset and scene brief](../../../../docs/superpowers/specs/2026-10-12-uni-studio-asset-brief.md).
The current character and art finish must remain provisional.

**Key Characteristics:**

- One continuous, fixed WebGL scene beneath native product sections.
- Pale sculpted architecture, cobalt route accents and cyan lighting.
- Be Vietnam Pro for the landing copy, with large headlines and one opening CTA.
- Deterministic scroll pose and camera, explicit pause and a still reduced-motion opening.
- A valid runtime proof with unresolved character likeness and action visibility.

## Colors

The studio combines pearl surfaces with cobalt and cyan. The foreground UI
uses the shared semantic theme slots; the scene consumes the same resolved
tokens rather than maintaining an independent palette.

### Primary

- **Cobalt / theme blue:** brand identifies the opening headline emphasis,
  conversion actions, ramp inlay, hurdle and character iris. Dark mode uses
  the recorded brand-dark value.
- **Cyan light:** landing-close-light provides the scene rim light and the
  cyan end of the swept mane and tail. It also identifies the thin floor route.

### Secondary

- **Brand magenta:** brand-accent reaches the candidate tongue material through
  the scene palette's coral field. It is the shared theme accent, not a new
  approved character color; its visible treatment remains under art review.

### Neutral

- **Stage:** landing-stage is the scene background, fog and floor. The light
  version is cool pearl; the dark theme deepens the stage without changing the
  character shell.
- **Model shell:** landing-model-shell colors the body, architecture, several
  lights and the official vest decal. The built value stays the same in both
  themes.
- **Deep navy:** landing-deep colors the vest, hooves, pupils and contact
  shadow. This slot also stays the same in both themes.
- **UI planes and ink:** background, foreground, muted-foreground and border
  retain their shared light/dark assignments for content and controls.

**The Shared Palette Rule.** Read colors from
[the shared token sheet](../../../../packages/ui/styles/tokens.css).
CinematicWorld resolves CSS colors to sRGB for Three.js and rebuilds the
renderer when the root theme class changes. The values above are an extracted
snapshot, not a second source to edit.

## Typography

**Display and body font:** Be Vietnam Pro, with sans-serif fallback.
The landing loader includes Latin and Vietnamese subsets and weights 400–800.
Marketing overrides its heading and display variables with that same face.

The hierarchy is a large opening statement above calmer product explanations.
Headings use balanced wrapping; paragraphs use pretty wrapping. This record
does not extend the system display face used inside the inherited product
illustration into the landing's typographic standard.

### Hierarchy

- **Opening display:** the recorded display role applies on desktop. At widths
  through 767px it becomes clamp(36px, 9vw, 48px), with 1.08 leading. The final
  tracking is -0.04em.
- **Section headline:** the recorded headline role is the repeated default.
  The workspace headline uses the existing 60px role with 1.08 leading;
  selected chapters use the 36px role. Mobile reductions follow their existing
  chapter styles.
- **Body:** the landing base uses the shared 16px title-small role.
- **Descriptions:** the repeated section explanation uses the recorded
  description role and a 60ch maximum. The opening explanation uses 18px,
  1.6 leading and 43ch; on mobile it uses 15px and 36ch.
- **Navigation and details:** navigation uses the shared 14px body role;
  supporting captions use the 12px caption role. No new eyebrow style is
  established by this studio candidate.

**The Language Coverage Rule.** Keep the landing face and full diacritic
coverage across English and Vietnamese. Recheck wrapping after locale changes;
a camera opening is not permission to crop a translated headline.

## Layout

The world host fills the viewport and stays fixed behind the entire landing.
The root establishes an isolated stacking context; the world sits at z-index
-1 and does not intercept pointer input. The DOM owns the page height,
navigation, content and conversion flow.

The desktop opening reserves the left side for copy and the right side for
UNI and architecture. The built copy panel is 47% wide with a 560px cap,
28px padding and 24px corners. The hero is at least 105svh tall with a responsive
top inset and an 80px bottom inset. The opening camera is perspective-based
(38° field of view); the actor is approximately 3.4 scene units high. Scene
units are world scale, not DOM pixels.

The shared Container provides a centered 80rem maximum with 16px horizontal
padding, increasing to 24px from the small breakpoint. Large existing story
frames cap at 1400px; their outer gutters step from 32px to 20px to 12px.
The studio override gives repeated foreground containers 32px corners.
Chapter spacing remains the existing 100px vertical rhythm, with chapter
specific responsive rules. Two open passages expose the world for 68svh.

At widths through 767px, the opening copy centers, becomes full width with a
500px cap and uses 20px by 14px padding. The hero grows to at least 115svh,
with a 122px top inset and 32px bottom inset. Open passages become 50svh,
the AI world window becomes at least 48svh, AI copy padding becomes 24px,
and the foreground container corners become 24px. The mobile camera moves
further back and raises its look target to leave room above UNI for copy.

**Unapproved composition:** foreground panels hide the actor over substantial
parts of the actual scroll route, including the second jump and closing
greeting. The two passage spacers do not establish sufficient visible action.
The section timeline, camera framing and foreground openings require further
direction across desktop and mobile. Do not reuse the current occlusion or
camera scale as an approved composition rule.

## Elevation & Depth

The runtime has real volume, perspective, contact shadows and a desktop floor
reflection. Its atrium contains thick beveled arches, stacked gallery slabs,
roof ribs, a ramp at the first jump and a low hurdle at the second. Materials
use physical roughness and restrained clearcoat. The floor uses roughness
0.42 and clearcoat 0.18; pale architecture uses roughness 0.5. The current
reflection is a 768px render target with a slightly transparent floor above it.

RoomEnvironment lighting, a hemisphere light, key, rim, spot and fill provide
the current illumination. ACES filmic tone mapping uses exposure 0.9; stage
fog runs from 16 to 40 scene units. The pale masses and lighting remain too
uniform to claim the differentiated atrium, ramp and directional daylight
of the selected concept. A cinematic finish has not been accepted.

The UI keeps existing diffuse shadows where they already express a floating
dock or action. The navigation dock uses a low navy-tinted shadow; its scrolled
state deepens it. The hero action has a small brand-tinted shadow. The motion
control has a low navy-tinted shadow. Their exact values live in the scoped
sidecar; these treatments do not justify obscuring the actor.

**The Grounded Action Rule.** Review the actor, floor, ramp and shadow in one
runtime frame. The source has stance/swing sampling and a contact-shadow
response, but believable planting, weight transfer and composited action
remain acceptance work.

## Shapes

The reusable UI language is rounded and readable: 12px opening actions,
18px navigation dock, 24px copy panels, 32px story containers and a circular
44px motion control. Large frames and copy corners reduce on mobile as
documented in Layout. Preserve the shared control and focus contracts.

The scene's architecture uses thick arches, curved galleries and a low
sculpted ramp with cobalt inlay. The candidate horse uses implicit sculpted
body/head surfaces, skinned two-bone limbs and swept tapered mane/tail
geometry. All action parts are volumetric; the runtime does not animate a
portrait plane. That technical fact does not establish fidelity to the
original horse. Shoulder openings, face and eye construction, hair ends and
overall likeness/finish remain below the reference and must be rebuilt or
replaced with the approved production asset.

## Components

### Opening action and navigation

The opening has one registration link in the shared brand button variant,
with a 48px minimum height, 24px horizontal padding and 12px corners.
The variant retains shared hover, active and keyboard focus behavior.
The fixed dock retains its shared official Logo, product links, theme/language
controls and primary action; its content shell is 72px high on desktop.
Mobile uses the existing menu disclosure. Native links and buttons remain
outside the world, keyboard reachable and usable without WebGL.

### Foreground surfaces

The opening surface uses a 96% mix of the shared background. Most repeated
chapter containers use an opaque background; the AI copy panel adds the shared
border and uses 36px desktop padding. These are built readability treatments,
not an approved solution to action staging. The AI stage itself is transparent
and removes its former pseudo-element decoration and local stage shadow.

### Continuous studio world

[CinematicWorld](cinematic-world.tsx) owns the React host, preference listener,
manual pause state, normalized native scroll value, theme rebuild and fallback.
[createStudioWorld](animation/studio-world.ts) owns the renderer, scene,
camera, route, frame scheduling, resize, visibility/context events and cleanup.
[studio-horse.ts](animation/studio-horse.ts) is the provisional model/pose
adapter; architecture is built in [studio-architecture.ts](animation/studio-architecture.ts).

Progress is native scrollY divided by document scrollable distance.
The route is a Catmull–Rom curve and the same sample drives pose and camera.
The current action windows are first jump 0.255–0.345, landing 0.345–0.375,
second jump 0.665–0.725 and landing 0.725–0.755. Running eases in at the
opening and out by progress 1; the greeting appears at 0.96–1.
These windows record the candidate and are expected to change during
composition work. They are not a cinematic timing standard.

Frames interpolate toward the scroll target and stop once it settles.
There is no autonomous gait loop when scroll stops. Pause freezes the pose;
reduced motion initially opens on a still frame, with explicit playback
available. A preference change resets the manual override. Hidden documents
stop the frame loop; return resumes toward the sampled target.

Renderer DPR is capped at 1.5 on desktop and 1.2 below 768px. Shadow maps step
between 2048px and 1024px, and the floor reflection is disabled on mobile.
Resize updates those resources, canvas dimensions and camera aspect.
Unmount disposes geometry, materials, textures, lighting, render targets and
the renderer.

The vest decal is cloned from the shared official SVG Logo and rendered as a
texture; generated imagery is not logo authority. The
[studio fallback](../../public/landing/mascot/uni-studio-fallback.webp) covers
loading/no-WebGL and context-loss states. It has no baked UI and carries its
[exact generation prompt and provenance](../../public/landing/mascot/uni-studio-fallback.webp.provenance.json).
It is a static generated reference/fallback, not evidence of animated runtime.
On renderer failure the fallback is visible and the motion button is disabled.

### Evidence and review state

Valid motion evidence is the
[runtime video](../../../../.impeccable/review/studio-action.webm) and the
native-scroll frames studio-scroll-00 through studio-scroll-10, with desktop,
mobile, user-940 and opening-dark-en captures in the same review directory.
A stitched full-page image of a fixed canvas was rejected for scene review;
the corrected native-scroll evidence is valid. Valid evidence did not change
the latest finish disposition from **REBUILD**.

The implementing workflow reports eight focused e2e checks, web typecheck and
focused lint passing. The full make check gate was unavailable on this host.
These checks support renderer, scroll and motion-state behavior; they do not
approve the artwork. The remaining acceptance work is the production focal
model/rig, unobstructed route staging, differentiated architecture/daylight,
and believable planted run/jump/land action.

## Do's and Don'ts

### Do:

- **Do** preserve one fixed world and native document scroll.
- **Do** keep essential navigation and conversion in accessible native controls.
- **Do** read semantic theme colors from the shared token source.
- **Do** preserve the official SVG mark and the original horse as likeness authority.
- **Do** keep pause, reduced-motion, hidden-document and static fallback behavior.
- **Do** assess the complete action in native-scroll desktop/mobile video, in both themes and locales.
- **Do** keep this candidate marked draft until character and composition acceptance is explicit.

### Don't:

- **Don't** treat passing functional checks or valid screenshots as an overall visual pass.
- **Don't** canonize the procedural character, shoulder openings, face/hair defects or actor occlusion.
- **Don't** use the generated fallback as proof that a matching production 3D model exists.
- **Don't** call the confirmed choice record a fresh seed or a catalog quality bar.
- **Don't** carry this scoped landing composition into the authenticated app.
- **Don't** invent customer, adoption, availability or autonomous-agent evidence.

**Not canonized:** the current focal model's likeness and craft defects,
foreground occlusion, uniform architecture/light, unresolved action planting,
incumbent illustration system display faces and any incidental eyebrow copy.
These are either review gaps or inherited local artifacts, not standards for
future surfaces.
