export const POLL_QUESTION_MAX_LENGTH = 200;
export const POLL_OPTION_MAX_LENGTH = 120;
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 10;

export type RoomPollSettings = {
  deadlineAt: string | null;
  pinToTop: boolean;
  allowMultiple: boolean;
  allowAddOptions: boolean;
  hideResultsUntilVote: boolean;
  hideVoters: boolean;
};

export const DEFAULT_ROOM_POLL_SETTINGS: RoomPollSettings = {
  deadlineAt: null,
  pinToTop: false,
  allowMultiple: true,
  allowAddOptions: true,
  hideResultsUntilVote: false,
  hideVoters: false,
};

export type CreatePollInput = {
  question: string;
  options: string[];
  settings?: Partial<RoomPollSettings>;
  createdBy?: string;
};

export function mergePollSettings(settings?: Partial<RoomPollSettings>): RoomPollSettings {
  return { ...DEFAULT_ROOM_POLL_SETTINGS, ...settings };
}

export function normalizePollOptions(options: string[]): string[] {
  return options.map((option) => option.trim()).filter(Boolean);
}

export function canSubmitPoll(question: string, options: string[]): boolean {
  const trimmedQuestion = question.trim();
  const normalized = normalizePollOptions(options);
  return (
    trimmedQuestion.length > 0 &&
    trimmedQuestion.length <= POLL_QUESTION_MAX_LENGTH &&
    normalized.length >= POLL_MIN_OPTIONS &&
    normalized.length <= POLL_MAX_OPTIONS
  );
}

export function isPollExpired(deadlineAt: string | null | undefined, now = Date.now()): boolean {
  if (!deadlineAt || deadlineAt === "null") return false;
  const deadline = Date.parse(deadlineAt);
  if (!Number.isFinite(deadline)) return false;
  return deadline <= now;
}

export function parsePollDeadlineInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export type PollVotesByUser = Record<string, string[]>;

export type PollVisibilityInput = {
  settings: {
    hide_voters: boolean;
    hide_results_until_vote: boolean;
  };
  viewer_option_ids?: string[];
  votes_by_user?: PollVotesByUser;
};

export function canViewPollVoters(poll: PollVisibilityInput): boolean {
  if (poll.settings.hide_voters) return false;
  const hasVoted = (poll.viewer_option_ids?.length ?? 0) > 0;
  if (poll.settings.hide_results_until_vote && !hasVoted) return false;
  return poll.votes_by_user != null;
}

export function groupPollVotersByOption(
  votesByUser: PollVotesByUser | undefined,
  optionIds: string[],
): Record<string, string[]> {
  const grouped = Object.fromEntries(optionIds.map((id) => [id, [] as string[]]));
  if (!votesByUser) return grouped;
  for (const [userId, selectedOptionIds] of Object.entries(votesByUser)) {
    for (const optionId of selectedOptionIds) {
      if (grouped[optionId]) {
        grouped[optionId] = [...grouped[optionId], userId];
      }
    }
  }
  return grouped;
}

export function resolvePollVoterLabel(
  userId: string,
  nameContext: Array<{ user_id: string; display_name: string }>,
  currentUserId: string,
  youLabel: string,
): string {
  const normalized = userId.trim().toUpperCase();
  const current = currentUserId.trim().toUpperCase();
  if (normalized === current) return youLabel;
  const entry = nameContext.find((item) => item.user_id.trim().toUpperCase() === normalized);
  return entry?.display_name?.trim() || userId;
}
