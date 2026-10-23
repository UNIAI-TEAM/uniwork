import { z } from "zod";

export const MeetingSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  description: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  room_name: z.string(),
  created_by: z.string(),
  created_at: z.string().optional(),
  status: z.string().optional(),
  meeting_type: z.string().optional(),
  host_user_id: z.string().optional(),
  timezone: z.string().optional(),
  allow_join_request: z.boolean().optional(),
  project_id: z.string().optional(),
  actual_start_at: z.string().optional(),
  actual_end_at: z.string().optional(),
  version: z.number().optional(),
  /** List rows only: a recording with a file exists, so the row can offer a rewatch. */
  has_playable_recording: z.boolean().optional(),
  /** Minimum attendance (%); null or absent = none. */
  quorum_percent: z.number().nullish(),
  /** The AI scribe is on for this meeting (default on; host/admin switch it). */
  scribe_enabled: z.boolean().optional(),
  /** Detail only: the latest scribe run, DISPATCHED | ACTIVE | FINISHED | FAILED. */
  scribe_status: z.string().optional(),
  /** The host or a clerk shared the AI content (transcript, summary) with the whole workspace. */
  ai_content_shared: z.boolean().optional(),
  /**
   * Detail only, per viewer: may read the AI content. Absent (an older
   * server) reads as readable; the reads themselves still answer 403.
   */
  ai_content_readable: z.boolean().optional(),
});
export type Meeting = z.infer<typeof MeetingSchema>;

export const MeetingNoteSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  author_id: z.string(),
  body: z.string(),
  display_name: z.string().optional(),
  avatar_url: z.string().nullish(),
  created_at: z.string().nullish(),
});
export type MeetingNote = z.infer<typeof MeetingNoteSchema>;

export const JoinDecisionSchema = z.object({
  decision: z.string(),
  reason: z.string().optional(),
  meeting_status: z.string().optional(),
  conference_session_id: z.string().optional(),
  provider: z.string().optional(),
  server_url: z.string().optional(),
  participant_token: z.string().optional(),
  expires_at: z.string().optional(),
  join_request_id: z.string().optional(),
  guest_session: z.string().optional(),
});
export type JoinDecision = z.infer<typeof JoinDecisionSchema>;

export const ParticipantSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  principal_type: z.string(),
  user_id: z.string().optional(),
  guest_id: z.string().optional(),
  display_name_snapshot: z.string().optional(),
  role: z.string(),
  status: z.string(),
  /** MEMBER votes and counts toward attendance; OBSERVER does neither. */
  standing: z.string().optional(),
  is_secretary: z.boolean().optional(),
  /** This participant's mic is the room's shared one: the AI scribe tells its speakers apart. */
  shared_mic: z.boolean().optional(),
});
export type MeetingParticipant = z.infer<typeof ParticipantSchema>;

/** A speaker label of a meeting's transcript and whom a clerk assigned it to. */
export const SpeakerLabelSchema = z.object({
  id: z.string(),
  label_key: z.string(),
  /** The provider's label ("A", "B", …), the last part of label_key. */
  speaker: z.string().optional(),
  /** "Speaker n" in this meeting, by first appearance. */
  number: z.number().optional(),
  user_id: z.string().optional(),
  name: z.string().optional(),
  /** What the transcript shows for it; empty while unassigned. */
  assigned_name: z.string().optional(),
  sample: z.string().optional(),
  first_spoken_at: z.string().optional(),
});
export type SpeakerLabel = z.infer<typeof SpeakerLabelSchema>;

export const JoinRequestSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  requester_user_id: z.string().optional(),
  display_name_snapshot: z.string().optional(),
  status: z.string(),
});
export type MeetingJoinRequest = z.infer<typeof JoinRequestSchema>;

export const InvitationSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  participant_id: z.string(),
  response_status: z.string(),
});
export type MeetingInvitation = z.infer<typeof InvitationSchema>;

export const InviteLinkSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  name: z.string(),
  access_mode: z.string(),
  expires_at: z.string(),
  max_uses: z.number().optional(),
  used_count: z.number(),
  revoked_at: z.string().optional(),
  created_at: z.string().optional(),
  secret: z.string().optional(),
});
export type MeetingInviteLink = z.infer<typeof InviteLinkSchema>;

export const MeetingStatisticsSchema = z.object({
  total: z.number(),
  /** Scheduled meetings that can still start (ends_at not yet passed). */
  scheduled: z.number(),
  /** Scheduled meetings whose window passed without starting; absent from older servers. */
  missed: z.number().optional(),
  in_progress: z.number(),
  ended: z.number(),
  canceled: z.number(),
  instant: z.number().optional(),
  invitation_pending: z.number().optional(),
  invitation_accepted: z.number().optional(),
  invitation_declined: z.number().optional(),
  invitation_tentative: z.number().optional(),
  join_request_total: z.number().optional(),
  join_request_approved: z.number().optional(),
  join_request_rejected: z.number().optional(),
  avg_approval_seconds: z.number().optional(),
  invite_links_created: z.number().optional(),
  invite_links_used: z.number().optional(),
  invite_links_revoked: z.number().optional(),
  invite_links_expired: z.number().optional(),
});
export type MeetingStatistics = z.infer<typeof MeetingStatisticsSchema>;

export const ActivityItemSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  actor_id: z.string(),
  from_state: z.string().optional(),
  to_state: z.string().optional(),
  occurred_at: z.string(),
  /** MOTION_OPENED `{title}` and MOTION_CLOSED `{title, outcome}` only; absent elsewhere. */
  payload: z.record(z.string(), z.string()).optional(),
});
export type MeetingActivityItem = z.infer<typeof ActivityItemSchema>;

export const TranscriptSegmentSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  participant_id: z.string().optional(),
  speaker_name: z.string().optional(),
  text: z.string(),
  spoken_at: z.string(),
  /** Set only on a room-microphone line nobody has named: the raw label (":?" = unknown speaker)… */
  speaker_label: z.string().optional(),
  /** …and its "Speaker n" number in the meeting (absent when unknown). */
  room_speaker: z.number().optional(),
  /** CAPTION | AGENT | TRANSCRIPTION (an uploaded recording). */
  source: z.string().optional(),
  transcription_id: z.string().optional(),
  start_ms: z.number().optional(),
  end_ms: z.number().optional(),
  /** vi | en when the source says (UNI-1995 #9: the captions' srcLang). */
  language: z.string().optional(),
  /** Set once a clerk corrected the line (UNI-1995 #5); the first wording stays on the server. */
  edited_at: z.string().optional(),
});
export type MeetingTranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  participant_id: z.string().optional(),
  sender_identity: z.string().optional(),
  sender_name: z.string().optional(),
  message: z.string(),
  sent_at: z.string(),
});
export type MeetingChatMessage = z.infer<typeof ChatMessageSchema>;

const EvidenceRefSchema = z.object({
  /** segment, note or chat; a switch over it carries a default for a kind a newer server adds. */
  kind: z.string(),
  id: z.string(),
});
/** One input line a decision or an action item rests on (meeting_summary@5). */
export type MeetingEvidenceRef = z.infer<typeof EvidenceRefSchema>;

/** References kept one by one: a malformed one is dropped, a missing list is none. */
export const EvidenceListSchema = z
  .unknown()
  .optional()
  .transform((raw): MeetingEvidenceRef[] =>
    Array.isArray(raw)
      ? raw.flatMap((r) => {
          const parsed = EvidenceRefSchema.safeParse(r);
          return parsed.success ? [parsed.data] : [];
        })
      : [],
  );

/** A decision; summaries stored before @5 hold bare strings, which read as decisions with no evidence. */
const DecisionSchema = z.union([
  z.string().transform((text) => ({ text, evidence: [] as MeetingEvidenceRef[] })),
  z.object({ text: z.string(), evidence: EvidenceListSchema }),
]);
export type MeetingSummaryDecision = z.infer<typeof DecisionSchema>;

/** Decisions kept one by one: a malformed entry is dropped, not the summary. */
const SummaryDecisionsSchema = z.array(z.unknown()).transform((raw) =>
  raw.flatMap((d) => {
    const parsed = DecisionSchema.safeParse(d);
    return parsed.success ? [parsed.data] : [];
  }),
);

/** A topic of a meeting_summary@7 record: where it starts and its key points. */
const SummaryTopicSchema = z.object({
  title: z.string(),
  /** The transcript segment the topic starts at; null when none is known. */
  start: EvidenceRefSchema.nullish().catch(null),
  /** RFC 3339: when that segment was said; null when unknown (and on a summary just created). */
  start_at: z.string().nullish().catch(null),
  points: SummaryDecisionsSchema.catch([]),
});
export type MeetingSummaryTopic = z.infer<typeof SummaryTopicSchema>;

/** Topics kept one by one: a malformed topic is dropped, not the summary. */
const SummaryTopicsSchema = z.array(z.unknown()).transform((raw) =>
  raw.flatMap((t) => {
    const parsed = SummaryTopicSchema.safeParse(t);
    return parsed.success ? [parsed.data] : [];
  }),
);

export const MeetingSummarySchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  summary: z.string(),
  decisions: SummaryDecisionsSchema.nullish(),
  model: z.string().nullish(),
  created_by: z.string().nullish(),
  /** "system" for the summary made when the meeting ended (UNI-2026). */
  created_by_kind: z.string().nullish(),
  created_at: z.string().nullish(),
  /** The transcript was longer than the summary's input budget. */
  partial: z.boolean().optional(),
  /** The transcript was corrected, cut or replaced after this summary was made (UNI-1995 #5). */
  transcript_changed_at: z.string().nullish(),
  /** meeting_summary@7's topics in the order discussed; empty on an older summary. */
  topics: SummaryTopicsSchema.catch([]).optional(),
  /** Questions raised and left open, each with its evidence (meeting_summary@7). */
  open_questions: SummaryDecisionsSchema.catch([]).optional(),
});
export type MeetingSummary = z.infer<typeof MeetingSummarySchema>;

/**
 * Whether a summary is being made (UNI-1995): running = a model call is under
 * way, queued = the server will make one (waiting for the last lines or for a
 * retry after a passing failure), idle = none. An unknown status reads idle.
 */
export const MeetingSummaryRunSchema = z
  .object({
    status: z.enum(["idle", "queued", "running"]).catch("idle"),
    /** RFC 3339: when the run started (running) or is due (queued); null when idle. */
    at: z.string().nullish().catch(null),
    /** How many times the server has tried the automatic summary. */
    attempts: z.number().int().nonnegative().catch(0),
  })
  .catch({ status: "idle", at: null, attempts: 0 });
export type MeetingSummaryRun = z.infer<typeof MeetingSummaryRunSchema>;

/** The organization's meeting settings (UNI-2026). */
export const MeetingSettingsSchema = z.object({
  organization_id: z.string(),
  auto_summary_enabled: z.boolean(),
  /** on | opt_in | off; an older server omits it (on). Narrow with scribePolicyOf. */
  scribe_policy: z.string().optional(),
  updated_by: z.string().nullish(),
  updated_by_kind: z.string().nullish(),
  updated_at: z.string().nullish(),
  /** Days transcripts and uploaded audio are kept; null keeps them (UNI-1995 #5). */
  transcript_retention_days: z.number().nullish().catch(null),
});
export type MeetingSettings = z.infer<typeof MeetingSettingsSchema>;

export const RecordingSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  status: z.string(),
  file_url: z.string().optional(),
  started_by: z.string().optional(),
  started_at: z.string().optional(),
  ended_at: z.string().optional(),
});
export type MeetingRecording = z.infer<typeof RecordingSchema>;

export const MeetingCapabilitiesSchema = z.object({
  ai_summary: z.boolean().optional(),
  recording: z.boolean().optional(),
  /** The AI scribe agent serves this workspace's meetings. */
  scribe: z.boolean().optional(),
  /** Uploaded recordings may be transcribed in batch (UNI-2001). */
  transcription: z.boolean().optional(),
  /** The organization's scribe policy: a new meeting starts with the scribe on unless opt_in. */
  scribe_policy: z.string().optional(),
});
export type MeetingCapabilities = z.infer<typeof MeetingCapabilitiesSchema>;

/** The organization's AI scribe policy (UNI-1995). */
export type ScribePolicy = "on" | "opt_in" | "off";
export const SCRIBE_POLICIES: readonly ScribePolicy[] = ["on", "opt_in", "off"];

/** Narrows the server's string; anything unknown (or absent) is the default, on. */
export function scribePolicyOf(raw: string | null | undefined): ScribePolicy {
  switch (raw) {
    case "opt_in":
      return "opt_in";
    case "off":
      return "off";
    default:
      return "on";
  }
}

export type AttendanceStatus = "PRESENT" | "LATE" | "EXCUSED" | "ABSENT";
export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = ["PRESENT", "LATE", "EXCUSED", "ABSENT"];

export const AttendanceRowSchema = z.object({
  participant_id: z.string(),
  principal_type: z.string(),
  user_id: z.string().optional(),
  display_name: z.string(),
  standing: z.string(),
  is_secretary: z.boolean(),
  status: z.string(),
  /** AUTO | MANUAL | SUGGESTED (a suggestion not yet frozen by finalize). */
  source: z.string(),
  note: z.string().optional(),
  first_joined_at: z.string().optional(),
  last_left_at: z.string().optional(),
  in_room: z.boolean().optional(),
  present_seconds: z.number(),
  session_count: z.number(),
  /**
   * Finalized roll only: marked when finalized, no longer on the meeting. Still
   * counted, because the finalized numbers are a snapshot. Older servers omit it.
   */
  removed: z.boolean().catch(false),
  /**
   * Finalized roll only: added after finalize, so it has no mark and is not
   * counted until the roll is reopened. Older servers omit it.
   */
  joined_after_finalize: z.boolean().catch(false),
});
export type MeetingAttendanceRow = z.infer<typeof AttendanceRowSchema>;

export const MeetingAttendanceSchema = z.object({
  finalized_at: z.string().optional(),
  finalized_by: z.string().optional(),
  quorum_percent: z.number().nullish(),
  summary: z.object({
    members: z.number(),
    present: z.number(),
    late: z.number(),
    excused: z.number(),
    absent: z.number(),
    quorum_met: z.boolean().nullish(),
  }),
  rows: z.array(AttendanceRowSchema),
});
export type MeetingAttendance = z.infer<typeof MeetingAttendanceSchema>;


export type MotionStatus = "DRAFT" | "OPEN" | "CLOSED";
export type BallotMode = "PUBLIC" | "SECRET";
export type MotionThreshold = "MAJORITY" | "TWO_THIRDS";
export type MotionBase = "PRESENT" | "ALL_MEMBERS";
export type BallotChoice = "YES" | "NO" | "ABSTAIN";
export type MotionOutcome = "PASSED" | "FAILED";
export const BALLOT_CHOICES: readonly BallotChoice[] = ["YES", "NO", "ABSTAIN"];

/**
 * One item on a meeting's voting list (GET /meetings/{id}/motions). Enums stay
 * z.string() so a newer server's value does not drop the whole list. `result`
 * is null until CLOSED, even for the host; `voters` only on a closed public
 * ballot; `my_ballot.choice` only once a public ballot is cast.
 */
export const MeetingMotionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  position: z.number(),
  ballot_mode: z.string(),
  threshold: z.string(),
  base: z.string(),
  status: z.string(),
  opened_at: z.string().nullish(),
  closed_at: z.string().nullish(),
  /** Members on the roll when voting opened; null while DRAFT. */
  roll_size: z.number().nullish(),
  total_members: z.number().nullish(),
  cast_count: z.number().optional(),
  result: z
    .object({
      yes: z.number(),
      no: z.number(),
      abstain: z.number(),
      required: z.number(),
      outcome: z.string(),
    })
    .nullish(),
  voters: z
    .object({
      yes: z.array(z.string()),
      no: z.array(z.string()),
      abstain: z.array(z.string()),
    })
    .nullish(),
  my_ballot: z
    .object({
      on_roll: z.boolean(),
      cast: z.boolean(),
      choice: z.string().nullish(),
    })
    .optional(),
});
export type MeetingMotion = z.infer<typeof MeetingMotionSchema>;

export type MotionDraftInput = {
  title: string;
  description: string;
  ballot_mode: BallotMode;
  threshold: MotionThreshold;
  base: MotionBase;
};

/** One transcription of one uploaded recording (UNI-2001). */
export const MeetingTranscriptionSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  file_id: z.string().optional(),
  filename: z.string().optional(),
  size_bytes: z.number().optional(),
  language: z.string().optional(),
  /** QUEUED | RUNNING | COMPLETE | FAILED */
  status: z.string(),
  /** file_unavailable | provider_error | timeout */
  error_code: z.string().optional(),
  attempts: z.number().optional(),
  starts_at: z.string().optional(),
  audio_seconds: z.number().optional(),
  created_by: z.string().optional(),
  created_at: z.string().optional(),
  completed_at: z.string().optional(),
});
export type MeetingTranscription = z.infer<typeof MeetingTranscriptionSchema>;
