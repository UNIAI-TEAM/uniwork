/**
 * Pure rules of the meeting detail page (PLAN §1.4): who is looking, which
 * tabs exist, which sections render. `DetailContext` is built from these, so
 * every slot reads the same answer.
 */

export type DetailViewer = "host" | "secretary" | "admin" | "member" | "outsider";
export type DetailTab = "overview" | "transcript" | "minutes" | "notes";
/** What `displayMeetingStatus` returns, plus anything newer a server may send. */
export type DetailStatus = "SCHEDULED" | "IN_PROGRESS" | "OVERTIME" | "MISSED" | "ENDED" | "CANCELED" | (string & {});

type ParticipantLike = { user_id?: string; status: string; principal_type: string; is_secretary?: boolean };

/**
 * The viewer's seat: the meeting's host, an active secretary, a workspace
 * admin who can run it (`canHost` without being the host), an active
 * participant, or a workspace member outside the meeting.
 */
export function viewerRole({
  userId,
  hostUserId,
  participants,
  canHost,
}: {
  userId: string;
  hostUserId?: string;
  participants: readonly ParticipantLike[];
  canHost: boolean;
}): DetailViewer {
  if (userId !== "" && userId === hostUserId) return "host";
  const mine = participants.find((p) => p.status === "ACTIVE" && p.principal_type === "USER" && p.user_id === userId);
  if (mine?.is_secretary) return "secretary";
  if (canHost) return "admin";
  return mine ? "member" : "outsider";
}

const live = (status: DetailStatus) => status === "IN_PROGRESS" || status === "OVERTIME";

/**
 * The page's tabs: ended → Tổng quan · Lời thoại · Biên bản; live → Ghi chú
 * chung · Lời thoại; none before, after a miss or a cancel, or for an
 * outsider. Lời thoại needs AI content the viewer may read; Biên bản needs the
 * organization's minutes flag.
 */
export function visibleTabs(
  status: DetailStatus,
  viewer: DetailViewer,
  flags: { aiReadable: boolean; minutes: boolean },
): DetailTab[] {
  if (viewer === "outsider") return [];
  if (live(status)) return flags.aiReadable ? ["notes", "transcript"] : ["notes"];
  if (status !== "ENDED") return [];
  const tabs: DetailTab[] = ["overview"];
  if (flags.aiReadable) tabs.push("transcript");
  if (flags.minutes) tabs.push("minutes");
  return tabs;
}

export type SectionFlags = {
  /** Summary, transcript and Ask UNI: the people of the meeting only (AfterOutsider). */
  ai: boolean;
  /** The notes feed: never for an outsider (PLAN D14, a client rule). */
  notes: boolean;
  /** The notes composer: also not on a missed or canceled meeting; no lock after the end (D14). */
  notesInput: boolean;
  /** Action items once the meeting has started (an outsider sees the assigned ones only). */
  actionItems: boolean;
  /** The minutes, once ended, when the organization has them on. */
  minutes: boolean;
  /** Work carried over from earlier meetings, before and during one with a project. */
  carriedOver: boolean;
  /** Guest links (rail "Khách", ScheduledHost row): host or admin, before the end; never in person (no room to enter). */
  guestLinks: boolean;
  /** Guests waiting at the door: host or admin while live (overtime included). */
  lobby: boolean;
};

export function sectionFlags({
  status,
  viewer,
  aiReadable,
  minutesOn,
  hasProject,
  inPerson = false,
}: {
  status: DetailStatus;
  viewer: DetailViewer;
  aiReadable: boolean;
  minutesOn: boolean;
  hasProject: boolean;
  inPerson?: boolean;
}): SectionFlags {
  const outsider = viewer === "outsider";
  const runner = viewer === "host" || viewer === "admin";
  const scheduled = status === "SCHEDULED";
  const started = live(status) || status === "ENDED";
  return {
    ai: started && aiReadable && !outsider,
    notes: !outsider,
    notesInput: !outsider && status !== "MISSED" && status !== "CANCELED",
    actionItems: started,
    minutes: status === "ENDED" && minutesOn,
    carriedOver: (scheduled || live(status)) && hasProject,
    guestLinks: runner && !inPerson && (scheduled || live(status)),
    lobby: runner && live(status),
  };
}
