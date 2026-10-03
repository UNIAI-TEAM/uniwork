import { ReviewCommentsGroup } from "../groups/review-comments";
import { ReviewTrackChangesGroup } from "../groups/review-track-changes";
import type { DocxToolbarTab } from "../types";

export const reviewTab: DocxToolbarTab = {
  id: "review",
  labelKey: "office.docx.toolbar.tabReview",
  groups: [
    { id: "review-track-changes", labelKey: "office.docx.toolbar.groups.trackChanges", component: ReviewTrackChangesGroup, collapseAt: 0 },
    { id: "review-comments", labelKey: "office.docx.toolbar.groups.comments", component: ReviewCommentsGroup, collapseAt: 900 },
  ],
};
