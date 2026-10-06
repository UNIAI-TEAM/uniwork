import { homeTab } from "./home";
import { insertTab } from "./insert";
import { layoutTab } from "./layout";
import { reviewTab } from "./review";
import { viewTab } from "./view";
import type { DocxToolbarTab } from "../types";

/** The five Word-style tabs, in display order. Each tab file owns its group
 * list; a group component lives in its own file under ../groups. */
export const DOCX_TOOLBAR_TABS: readonly DocxToolbarTab[] = [homeTab, insertTab, layoutTab, reviewTab, viewTab];
