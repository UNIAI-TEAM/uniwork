# FE Review — UNI-746 recording playability signal migration (commit 3b434165)

**Reviewer:** FE reviewer (review-only, no edits made)
**Scope:** `packages/views/meetings/{meeting-list-recording-button,meeting-room-copilot-tab,meeting-room-files-tab,meeting-summary-panel}.tsx`
**stage_outcome:** reviewed
**review_verdict:** clear

## Summary

All four sites were changed from gating recording playability on `recording.file_url`
truthiness to `recording.status === "COMPLETE"`. The change is correct and consistent:

| File | Before | After |
| --- | --- | --- |
| `meeting-list-recording-button.tsx:29` | `recordings?.find((r) => r.file_url)` | `recordings?.find((r) => r.status === "COMPLETE")` |
| `meeting-room-copilot-tab.tsx:84` | `(recordings ?? []).find((r) => r.file_url)` | `(recordings ?? []).find((r) => r.status === "COMPLETE")` |
| `meeting-room-copilot-tab.tsx:318` | `completedRecording?.file_url ? (...)` | `completedRecording ? (...)` (redundant double-gate removed, no behavior change since `completedRecording` is already filtered on `status`) |
| `meeting-room-files-tab.tsx:19` | `(recordings ?? []).filter((r) => r.file_url)` | `(recordings ?? []).filter((r) => r.status === "COMPLETE")`, with an added comment explaining why COMPLETE is the shared signal across legacy/FS rows |
| `meeting-summary-panel.tsx:337` | `r.file_url ? (...)` | `r.status === "COMPLETE" ? (...)` |

## Checks performed

1. **Identical behavior for legacy rows (COMPLETE + file_url) and FS rows (COMPLETE + file_id):**
   Confirmed by inspection — all four sites now branch solely on `status === "COMPLETE"`,
   so a legacy row and an FS-backed row are indistinguishable to the FE once both reach
   COMPLETE. None of the four sites read `file_url`/`file_id` for gating anymore; the actual
   playback source is resolved separately, out of band, via
   `resolveMeetingRecordingPlayback` / `getMeetingRecordingPlaybackUrl` in
   `packages/core/api/endpoints/meetings.ts`, keyed by `recordingId` (not `file_url`), so
   the gating change cannot desync from the playback path.

2. **No remaining `file_url`-as-playability gate for meeting recordings anywhere in
   `packages/views` or `packages/core`:** grepped both trees for `file_url`. Remaining
   hits are: the `MeetingRecording` schema field itself (`packages/core/types/meeting.ts:171`,
   now unused for gating, kept only as a passthrough data field), a stale-but-harmless
   `file_url` key still present in a `meeting-list-view.test.tsx:185` fixture (doesn't
   affect the assertion, since the fixture's `status` is already `"COMPLETE"`), and the
   unrelated chat-voice endpoint (`packages/core/api/endpoints/chat-voice.ts`), which is a
   separate domain not in this commit's diff. No leftover gate found.

3. **`chat-voice.ts` / chat voice playback path does not gate on `file_url`:** confirmed.
   `packages/views/chat/voice-call-log-row.tsx:79-80` gates the "recording ready" affordance
   on `message.voiceCall?.recording_status === "COMPLETE"`, and
   `packages/views/chat/chat-voice-recordings-sheet.tsx` (via
   `voice-call-log-row.tsx`'s `recordingStatus()` helper) gates the per-row Play button on
   the mapped `"complete"` status, not on `file_url`. `file_url` is retained in the
   `ChatVoiceRecording(Item)` types purely as a data field, unused for gating. This path was
   already status-based before this commit and needed no change.

4. **`MeetingRecording.status` type:** `packages/core/types/meeting.ts:170` —
   `status: z.string()`, required (not optional), so `recording.status === "COMPLETE"` is
   always a defined string comparison, never `undefined === "COMPLETE"`.

5. **i18n:** no translation keys added, removed or reworded by this diff; `t()` call sites
   are unchanged (`meetings.recording_play`, `meetings.recordingsLoadFailed`, etc.).

6. **Dead code:** none found. The redundant `completedRecording?.file_url` re-check in
   `meeting-room-copilot-tab.tsx` was correctly collapsed to a plain truthy check instead of
   being left as inert legacy guard.

## Findings

| id | file:line | trigger | impact | severity | fix owner |
| --- | --- | --- | --- | --- | --- |
| F1 | `packages/views/meetings/meeting-room-files-tab.test.tsx`, `meeting-summary-panel.test.tsx` | Neither test file exercises a recording row with `status: "COMPLETE"` — both only cover empty/loading/error states (files-tab) or an always-empty `recordings: []` fixture (summary-panel). `meeting-room-copilot-tab.test.tsx` only covers the negative case (`status: "ACTIVE"`, button absent). | The positive case this commit actually changes — a completed row rendering the Play affordance for both a legacy (`file_url`-only) and FS-backed (`file_id`-only) row — is unverified by any automated test in these two files, so a regression in the new gate (e.g. an accidental revert to `file_url`) would not be caught by `pnpm test`. | low-medium (test-coverage; pre-existing gap, not introduced by this diff, but this diff is exactly the behavior it fails to cover) | FE (test author for UNI-746, or a follow-up UNI-746 sub-issue) |
| F2 | `packages/views/meetings/meeting-list-recording-button.tsx:30` | Comment "The flag said yes but the list came back without a file (deleted since): nothing to offer." still says "without a file" | Purely a wording nit — the comment predates this diff and remains accurate in spirit (no COMPLETE row to offer), but "file" now conflates the legacy/FS distinction slightly | trivial (nit, no functional impact) | optional, not blocking |

## What's left

Nothing blocking. F1 is worth a follow-up test (assert the Play button/section renders for a
`status: "COMPLETE"` row with only `file_id` set, and one with only `file_url` set, per
component) before this ships to prove FS-row parity in CI rather than by inspection alone.
F2 is optional and can be left as-is or fixed in a drive-by.
