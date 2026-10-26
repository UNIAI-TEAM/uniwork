# Meeting detail (redesign, UNI-2153)

The meeting detail page built to the meeting boards kit v2. `MeetingDetailView`
(`../meeting-detail-view.tsx`) provides `DetailContext` (`detail-context.tsx`,
rules in `detail-model.ts`); every slot reads it through `useDetail()`.

- `ui/` — presentational atoms drawn to the kit: status pill, strip, notice
  line, rail rows, section heading and byline, text button, time chip and
  gutter row, count pill, segmented control, avatar stack, side sheet / 440
  dialog, and the kit button overrides (`kitButton`).
- `format.ts` — the page's time words; `avatar-tint.ts` — per-person tints by
  workspace join order.
- `test-fixtures.ts` — demo meetings M1/M3/M4/M5/M6 and the outsider M1,
  `routeMeeting()` for `requestMock`, `detailValue()` for a slot's context.

## Kit type roles → repo classes

| Kit class | Repo classes |
|---|---|
| `.t-display` | `text-display-sm font-bold` |
| `.t-title-lg` | `text-title-lg font-bold` |
| `.t-title` | `text-title-sm font-semibold` (not `text-title`, which is 18/24) |
| `.t-body-lg` | `text-body-lg` |
| `.t-body` | `text-body` |
| `.t-label` | `text-label font-medium` |
| `.t-caption` | `text-caption` |
| `.t-over` | `text-caption font-medium text-muted-foreground` (never `text-overline`) |
| `.t-time` | `font-mono text-caption font-medium` |
| avatar initials 20/24 · 28/32 | `MeetingPersonAvatar size={20\|24}` → `text-micro font-semibold tracking-tight`; `size={28\|32}` → `text-caption font-semibold` |

Breakpoints are container queries on `@container/meeting` (the page scroller):
`@max-[37.5rem]/meeting:` is the kit's phone (< 600), `@max-[58rem]/meeting:`
its rail-stacking width (< 1200 viewport at the default sidebar).
