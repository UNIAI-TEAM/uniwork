import type { useTranslation } from "react-i18next";
import type {
  DocumentAccessPreviewGroup,
  DocumentAccessPreviewUser,
} from "@uniwork/core/api/endpoints/documents-sharing";

type TFunction = ReturnType<typeof useTranslation>["t"];

/** What a dry_run preview says, in the future tense for the confirm box and in
 *  the past tense for the toast that follows the save (spec §5.2). */
export interface PreviewSentence {
  confirm: string;
  done: string;
}

export interface PreviewSentenceDeps {
  t: TFunction;
  levelLabel: (level: string) => string;
  sourceLabel: (via: string) => string;
}

export interface WarningSentenceInput {
  code: string;
  name: string;
  principalType: string;
  /** The level the item writes. */
  targetLevel: string;
  /** The principal's level before the write, when known. */
  beforeLevel?: string;
  user?: DocumentAccessPreviewUser;
  group?: DocumentAccessPreviewGroup;
}

/**
 * The sentence for one dry_run warning. `wide_scope` and `direct_below_group`
 * keep their own wording; every other code (`downgrade`, or one a newer server
 * adds) reads as a level change and branches by principal type, so a group is
 * never worded as a person. When the data a sentence needs is missing the
 * level-less sentence is used rather than a made-up level or a count of zero.
 */
export function warningSentence(
  { t, levelLabel, sourceLabel }: PreviewSentenceDeps,
  input: WarningSentenceInput,
): PreviewSentence {
  const { code, name, principalType, targetLevel, user, group } = input;
  const generic: PreviewSentence = {
    confirm: t("documents.share.warning_generic", { name }),
    done: t("documents.share.warning_generic_done", { name }),
  };
  const isOrganization = principalType === "organization";

  if (code === "wide_scope") {
    if (!group) return generic;
    const params = { name, count: group.member_count, level: levelLabel(targetLevel) };
    return isOrganization
      ? {
          confirm: t("documents.share.warning_wide_scope_organization", params),
          done: t("documents.share.warning_wide_scope_organization_done", params),
        }
      : {
          confirm: t("documents.share.warning_wide_scope_workspace", params),
          done: t("documents.share.warning_wide_scope_workspace_done", params),
        };
  }

  if (code === "direct_below_group") {
    if (!user?.after.level) return generic;
    const params = {
      name,
      effectiveLevel: levelLabel(user.after.level),
      source: sourceLabel(user.after.via),
    };
    return {
      confirm: t("documents.share.warning_direct_below_group", params),
      done: t("documents.share.warning_direct_below_group_done", params),
    };
  }

  const before = input.beforeLevel || user?.before.level;
  if (!before) return generic;
  const params = { name, before: levelLabel(before), after: levelLabel(targetLevel) };
  if (principalType === "user") {
    return {
      confirm: t("documents.share.warning_downgrade_person", params),
      done: t("documents.share.warning_downgrade_person_done", params),
    };
  }
  if (!group) return generic;
  const groupParams = { ...params, count: group.member_count };
  return {
    confirm: t("documents.share.warning_downgrade_group", groupParams),
    done: t("documents.share.warning_downgrade_group_done", groupParams),
  };
}

export interface RevokeSentenceInput {
  name: string;
  principalType: string;
  user?: DocumentAccessPreviewUser;
  group?: DocumentAccessPreviewGroup;
}

/** The sentence for revoking one principal's direct grant (FR-08 step 5, FR-09 step 4). */
export function revokeSentence(
  { t, levelLabel, sourceLabel }: PreviewSentenceDeps,
  { name, principalType, user, group }: RevokeSentenceInput,
): PreviewSentence {
  if (principalType === "user") {
    if (user?.after.level) {
      const params = { name, level: levelLabel(user.after.level), source: sourceLabel(user.after.via) };
      return {
        confirm: t("documents.share.revoke_confirm_keep", params),
        done: t("documents.share.revoke_done_keep", params),
      };
    }
    return {
      confirm: t("documents.share.revoke_confirm_lose", { name }),
      done: t("documents.share.revoke_done_lose", { name }),
    };
  }
  const params = { name, memberCount: group?.member_count ?? 0, losingCount: group?.losing_count ?? 0 };
  return {
    confirm: t("documents.share.revoke_confirm_group", params),
    done: t("documents.share.revoke_done_group", params),
  };
}
