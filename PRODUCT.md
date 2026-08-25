# Product

## Users

Small-to-medium Vietnamese teams (10–1,000 people) running daily operations — tasks, projects, meetings, documents, communications. Team leads, PMs, operators, developers, HR/ops admins, in the workspace many hours a day. Web, tablet, mobile. UI in Vietnamese or English (full parity both; Myanmar/Khmer/Lao are roadmap-only, flag as beta).

## Product Purpose

UNIWORK is an AI-native Work OS: humans and AI agents co-own tasks, co-attend meetings, co-author documents, co-run workflows. Success = the tool disappears into the work; a team coordinates people + agents without switching context, and every surface (task, meeting, doc, email, chat) feels built for the same flow.

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
8. Mobile-first PWA parity — bottom tabs, touch targets ≥44×44px, native-feeling transitions.

## Agent Principles

- Every agent action is visibly attributed and distinguishable from human actions at a glance.
- Agent writes are undoable with the same affordance as human undo; irreversible actions require human confirmation first.
- Show real agent state (queued/running/waiting/failed) with real timestamps — never fake progress.
- Humans can always pause, redirect, or take over agent work; agent activity history is filterable and readable.
- Agent copy uses the same calm register as human-facing copy — colleague, not mascot.

## Accessibility & Inclusion

WCAG AA (4.5:1 body text, 3:1 large text/UI components), verified in both modes. Full keyboard navigation for menus, dialogs, command palettes, task lists; focus indicators always visible. Errors inline and explicit, never color-only. Vietnamese + English copy parity; Vietnamese written natively, not translated word-by-word. Reduced-motion respected — all motion gates on `useReducedMotion` (sidebar is the reference pattern); motion 150–250ms, only to explain change, never decorative.