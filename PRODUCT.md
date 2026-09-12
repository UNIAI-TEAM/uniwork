# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Small-to-medium teams (10–1,000 people) running daily operations — tasks, projects, meetings, documents, communications. Team leads, PMs, operators, developers, HR/ops admins, in the workspace many hours a day. Web, tablet, mobile. Vietnam is the first market, not the boundary: it is where the product is sold and hardened first, and the things a market decides for itself — data residency, payment rails, the compliance regime named in the contract — belong in deployment configuration rather than in the model. UI in Vietnamese or English (full parity both; Myanmar/Khmer/Lao are roadmap-only, flag as beta).

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

The market is sequenced, not scoped. UniWork is built to be sold anywhere and
is being taken to Vietnam first, because that is where the team can reach
customers, close a support loop and be held to a real compliance regime before
the product is asked to survive a market nobody in the room knows. What that
sequence must never become is an assumption baked into the product: a country
in the data model, a currency the schema cannot change, or a claim on a public
surface that reads UniWork as software for one country.

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
- Web is the only host. The shared packages carry adapters so a desktop host
  can be added without rewriting the screens, but none exists. Mobile is a
  separate Expo / React Native app that shares only types and pure functions
  from core (ADR 0011); it does not exist yet either.

## Brand Personality

Restrained, precise, trustworthy. Interface stays neutral; color appears only as signal (status, brand, error). "克制即高级" — restraint reads as quality. Visual school: Stripe/Notion/Linear/Vercel/Retool — minimal, premium, spacious; strong type hierarchy, soft shadows, rounded corners, 8px grid.

## Anti-references

- Decorative color, hardcoded Tailwind palette values, gradient chrome, glassmorphism.
- SaaS-dashboard clichés: hero KPI cards, orchestrated load animations, oversized charts. In Insights: compact inline numbers and sparklines by default; a chart only when it answers a specific question.
- Custom controls where shadcn/Base UI standards exist.
- Dense admin UIs, tiny targets, crypto/gaming aesthetics, portal layouts.
- Mock data anywhere — empty states are truthful and explain the next step.
- AI theatrics: fake typing, artificial "thinking" delays, mascot-like agent avatars.

## Design Principles

1. Subtraction by default — every element must justify its existence; whitespace is design.
2. Speed is a feature — navigation interactive <200ms perceived, keystroke-to-render <50ms; spinner is a failure state, use skeletons ≤500ms.
3. Hierarchy through grayscale; color is semantic signal only (`brand`/`success`/`warning`/`danger`/`info`, max 2–3 per screen).
4. Consistency over personality — same interaction, same feedback, driven by tokens, never hardcoded values.
5. Max 3 text hierarchy levels per screen; 3-core-size type discipline (body, title, display).
6. Dark-first (users live in it all day), but every change verified in both light and dark mode.
7. Work OS navigation, not module menus — group by behavior: My Work, Communication, Knowledge, Automation, Insights.
8. Native mobile parity — a separate Expo app with the same product semantics as web (counts, permissions, enums, data identity); bottom tabs, touch targets ≥44×44px, iOS-native containers over re-implemented web patterns.

## Agent Principles

- Every agent action is visibly attributed and distinguishable from human actions at a glance.
- Agent writes are undoable with the same affordance as human undo; irreversible actions require human confirmation first.
- Show real agent state (queued/running/waiting/failed) with real timestamps — never fake progress.
- Humans can always pause, redirect, or take over agent work; agent activity history is filterable and readable.
- Agent copy uses the same calm register as human-facing copy — colleague, not mascot.

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
3. **Neither language is a translation layer.** Vietnamese and English are
   both written rather than generated from each other, and the parity test
   fails the build on a key missing from either. Vietnamese copy is written
   first because Vietnam is the first market; that is a sequence, not a rank,
   and no surface may present one language as the original and the other as
   its translation.
4. **Never advertise what does not exist.** No surface lists a capability, a
   customer, or a number the product cannot back today. Empty states explain
   the next step instead of showing mock rows.
5. **Restraint is the quality signal.** Subtraction by default; colour is
   signal; every element justifies its existence.

## Accessibility & Inclusion

WCAG AA (4.5:1 body text, 3:1 large text/UI components), verified in both modes. Full keyboard navigation for menus, dialogs, command palettes, task lists; focus indicators always visible. Errors inline and explicit, never color-only. Vietnamese and English copy parity; neither language is machine-translated from the other. Reduced-motion respected — all motion gates on `useReducedMotion` (sidebar is the reference pattern); motion 150–250ms, only to explain change, never decorative.