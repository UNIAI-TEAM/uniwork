import { ReviewProtectGroup } from "../../protect/review-protect";
import { ReviewCommentsGroup } from "../groups/review-comments";
import { ReviewCompareGroup } from "../groups/review-compare";
import { ReviewTrackChangesGroup } from "../groups/review-track-changes";
import type { DocxToolbarTab } from "../types";

export const reviewTab: DocxToolbarTab = {
  id: "review",
  labelKey: "office.docx.toolbar.tabReview",
  groups: [
    { id: "review-track-changes", labelKey: "office.docx.toolbar.groups.trackChanges", component: ReviewTrackChangesGroup, collapseAt: 0 },
    { id: "review-comments", labelKey: "office.docx.toolbar.groups.comments", component: ReviewCommentsGroup, collapseAt: 900 },
    { id: "review-compare", labelKey: "office.docx.toolbar.groups.compare", component: ReviewCompareGroup, collapseAt: 900 },
    { id: "review-protect", labelKey: "office.docx.toolbar.groups.protect", component: ReviewProtectGroup, collapseAt: 0 },
  ],
};
