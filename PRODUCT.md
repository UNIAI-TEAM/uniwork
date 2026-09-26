# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Small-to-medium Vietnamese teams (10–1,000 people) running daily operations — tasks, projects, meetings, documents, communications. Team leads, PMs, operators, developers, HR/ops admins, in the workspace many hours a day. Web, tablet, mobile. UI in Vietnamese or English (full parity both; Myanmar/Khmer/Lao are roadmap-only, flag as beta).

## Product Purpose

UniWork is an AI-native Work OS: humans and AI agents co-own tasks, co-attend meetings, co-author documents, co-run workflows. Success = the tool disappears into the work; a team coordinates people + agents without switching context, and every surface (task, meeting, doc, email, chat) feels built for the same flow.

## Positioning

Agents are co-owners of the work, not a feature bolted onto it. Neighbouring
products (Base.vn, Lark, Notion, Slack) attach AI as a button or a side panel
next to work that remains entirely human-owned. UniWork's data model and
permission model are built for an agent to own a task, attend a meeting and run
a workflow as a peer — which is why every agent action carries visible
attribution, its own undo, and a real state, rather than a chat transcript
beside the real record.

Nothing else in the product is claimed as unique. Tasks, meetings and workspaces
are table stakes; they are the ground the positioning stands on, not the claim.

## Operating Context

Pre-launch as of 2026-08-26: no one outside the development team uses UniWork.
Every future statement about adoption, usage, customers or outcomes starts from
zero — see Evidence on Hand.

What exists and runs today:

- Two membership tiers, organization and workspace, with slugs unique within an
  organization; URLs and the WebSocket handshake carry the pair `/{org}/{ws}`.
- Tasks with a board, statuses and comments; meetings with a scheduled record
  and a LiveKit video room; workspace members and email invitations.
- A four-step onboarding that creates the user's first organization and
  workspace and hands them a guide task.
- Realtime through a WebSocket relay: events are `<entity>.<verb>` with id-only
  payloads that invalidate caches rather than carrying state.
- Vietnamese and English at full parity. Myanmar, Khmer and Lao are roadmap
  only and must be flagged beta wherever they appear.
- Roadmap surfaces that do not run yet (Email Hub, Workflows, Documents, and
  the project views Timeline, Reports and Files) may appear in navigation and
  view tabs, but only locked and labelled "Sắp có" / "Coming soon": not
  clickable into a fake screen, no counts, no preview content. The label is
  removed the day the surface ships; nothing else about it may be shown early.
- Web is the only host. The shared packages carry adapters so a desktop host
  can be added without rewriting the screens, but none exists. Mobile is a
  separate Expo / React Native app that shares only types and pure functions
  from core (ADR 0011); it does not exist yet either.

## Brand Personality

Vivid, dense, scannable: a work tool people live in all day, in the family of
ClickUp. Colour does work: every module has its identity colour and every
state (status, priority, due, live) has its signal colour, so a glance at a
screen tells what kind of thing each row is and what condition it is in.
Screens where work happens are dense by design; hierarchy comes from type
weight, colour identity and grouping rather than from empty space. Trust comes
from precision: aligned grids, AA contrast in both modes, real numbers.

Reference direction confirmed by the owner (2026-09-17): the unidigiwork app
shell — a full top bar (search, + New, AI, notifications, account), a sidebar
grouped by behaviour, project pages opening on a project picker and view tabs
with a large title, project metric cards, and an AI Copilot panel on the right.
Screen-level layout lives in DESIGN.md and surface briefs, not here.

## Anti-references

- Decorative gradient chrome and glassmorphism. Colour is identity or signal,
  never ornament; the logo gradient stays in the logo.
- Hardcoded Tailwind palette values; every colour is a token.
- Vanity dashboards: metric cards that are not about the thing on screen,
  charts that answer no question, orchestrated load animations. Metric cards
  are welcome when they report the real state of the project or list in view.
- Custom controls where shadcn/Base UI standards exist.
- Tiny targets, cramped admin tables without grouping, crypto/gaming aesthetics.
- Mock data anywhere — empty states are truthful and explain the next step.
- AI theatrics: fake typing, artificial "thinking" delays, mascot-like agent avatars.

## Design Principles

1. Density where work happens, air where decisions happen. Task lists, boards
   and inboxes pack information and stay scannable; settings, onboarding and
   dialogs breathe. Every element still earns its place.
2. Speed is a feature — navigation interactive <200ms perceived, keystroke-to-render <50ms; spinner is a failure state, use skeletons ≤500ms.
3. Colour carries meaning, generously. Two families, never mixed: **tints** identify modules and categories (`tint-green` tasks, `tint-violet` meetings, `tint-blue` chat, `tint-pink` people… — one per module, read from `module-tones.ts`) on nav glyphs, icon tiles, page headers and empty states; **signals** report state (`brand`/`success`/`warning`/`danger`/`info`) on status pills, priority flags, due dates, badges and metric values. Use as many as the screen has meanings; a tint never means "ok/danger", a signal never decorates.
4. Consistency over personality — same interaction, same feedback, driven by tokens, never hardcoded values.
5. Clear type hierarchy: a large page title, section titles, body, and a small overline/meta size; no more sizes than that on one screen.
6. Dark-first (users live in it all day), but every change verified in both light and dark mode.
7. Work OS navigation, not module menus — group by behavior: Work, Communication, Knowledge, Automation, Insights, each group collapsible, with real unread/live badges.
8. Everything important is one reach away: global search, "+ New", AI and notifications live in the top bar on every workspace screen.
9. Native mobile parity — a separate Expo app with the same product semantics as web (counts, permissions, enums, data identity); bottom tabs, touch targets ≥44×44px, iOS-native containers over re-implemented web patterns.

## Agent Principles

- Every agent action is visibly attributed and distinguishable from human actions at a glance.
- Agent writes are undoable with the same affordance as human undo; irreversible actions require human confirmation first.
- Show real agent state (queued/running/waiting/failed) with real timestamps — never fake progress.
- Humans can always pause, redirect, or take over agent work; agent activity history is filterable and readable.
- Agent copy uses the same calm register as human-facing copy — colleague, not mascot.
- The AI Copilot panel shows only two kinds of content: metrics computed from
  real records (progress, overdue, blocked), and AI output actually generated
  for this project, labelled as AI with its source and generation time. With
  neither available it shows a truthful empty state, never sample insights.

## Evidence on Hand

The brand identity, and nothing else.

- Logo system: `packages/ui/brand/` — mark, wordmark, lockups, on-dark and
  monochrome variants, app and platform icons, and the guideline in its README.
  Generated from `scripts/brand/geometry.py`.
- The running product itself. Screenshots of real screens are legitimate proof;
  the interface is truthful because it is the interface.

Deliberately absent, and not to be invented by any later work: customers,
customer logos, testimonials, case studies, press, pilot results, adoption or
usage numbers, time-saved claims, pricing, availability dates, certifications,
and named partners. There are no users outside the team, so there is no usage
data to cite and none may be estimated.

## Product Principles

1. **Agents are peers, not features.** Anything an agent does gets the same
   record, the same attribution and the same undo a person's action gets. When
   a design choice would make agent work a second-class annotation on human
   work, that choice is wrong.
2. **The tool disappears into the work.** Success is a team coordinating people
   and agents without switching context — not time spent in UniWork, not
   features discovered.
3. **Vietnamese is the first language, not a translation layer.** Copy is
   written natively; parity with English is a floor, not the goal.
4. **Legibility at a glance is the quality signal.** A person scanning a
   screen for two seconds should know what each thing is, what state it is in
   and what needs them; colour, density and grouping serve that, not taste.

## Accessibility & Inclusion

WCAG AA (4.5:1 body text, 3:1 large text/UI components), verified in both modes. Full keyboard navigation for menus, dialogs, command palettes, task lists; focus indicators always visible. Errors inline and explicit, never color-only. Vietnamese + English copy parity; Vietnamese written natively, not translated word-by-word. Reduced-motion respected — all motion gates on `useReducedMotion` (sidebar is the reference pattern); motion 150–250ms, only to explain change, never decorative.
