import { ReviewProtectGroup, reviewProtectRibbonItems } from "../../protect/review-protect";
import { ReviewCommentsGroup, reviewCommentsRibbonItems } from "../groups/review-comments";
import { ReviewCompareGroup, reviewCompareRibbonItems } from "../groups/review-compare";
import { ReviewTrackChangesGroup, reviewTrackChangesRibbonItems } from "../groups/review-track-changes";
import type { DocxToolbarTab } from "../types";

export const reviewTab: DocxToolbarTab = {
  id: "review",
  labelKey: "office.docx.toolbar.tabReview",
  groups: [
    {
      id: "review-track-changes",
      labelKey: "office.docx.toolbar.groups.trackChanges",
      component: ReviewTrackChangesGroup,
      ribbonItems: reviewTrackChangesRibbonItems,
      collapseAt: 0,
    },
    {
      id: "review-comments",
      labelKey: "office.docx.toolbar.groups.comments",
      component: ReviewCommentsGroup,
      ribbonItems: reviewCommentsRibbonItems,
      collapseAt: 900,
    },
    {
      id: "review-compare",
      labelKey: "office.docx.toolbar.groups.compare",
      component: ReviewCompareGroup,
      ribbonItems: reviewCompareRibbonItems,
      collapseAt: 900,
    },
    {
      id: "review-protect",
      labelKey: "office.docx.toolbar.groups.protect",
      component: ReviewProtectGroup,
      ribbonItems: reviewProtectRibbonItems,
      collapseAt: 0,
    },
  ],
};
