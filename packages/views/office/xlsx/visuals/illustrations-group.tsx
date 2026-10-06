"use client";

// UNI-940 X02: Insert > Illustrations - Pictures (a local PNG/JPEG/GIF via
// the file picker) and Shapes (DrawingML presets), both landing at the active
// cell in the editor's visual overlay.
import { ArrowLeft, ArrowRight, Circle, ImagePlus, Minus, RectangleHorizontal, Shapes, SquareRoundCorner, Triangle, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { XlsxVisualShapeType } from "@uniwork/office-engine/xlsx";
import { XlsxGroupBody, XlsxLargeButton, XlsxLargeLabel } from "../toolbar/group-layout";
import { XlsxVisualMenu } from "./visual-menu";
import { useXlsxVisualsCommands } from "./visuals-context";

const SHAPE_TYPES: readonly { readonly type: XlsxVisualShapeType; readonly icon: LucideIcon }[] = [
  { type: "rect", icon: RectangleHorizontal },
  { type: "roundRect", icon: SquareRoundCorner },
  { type: "ellipse", icon: Circle },
  { type: "triangle", icon: Triangle },
  { type: "rightArrow", icon: ArrowRight },
  { type: "leftArrow", icon: ArrowLeft },
  { type: "line", icon: Minus },
];

export function XlsxIllustrationsGroup() {
  const { t } = useTranslation();
  const visuals = useXlsxVisualsCommands();
  const blocked = !visuals?.available;
  const pending = t("office.xlsx.capabilityPending");
  const pictureLabel = t("office.xlsx.visuals.picture.insert");
  return (
    <XlsxGroupBody>
      <XlsxLargeButton
        aria-label={pictureLabel}
        title={blocked ? pending : pictureLabel}
        aria-disabled={blocked || undefined}
        data-testid="xlsx-visuals-picture"
        onClick={() => { if (!blocked) visuals?.insertPicture(); }}
      >
        <ImagePlus aria-hidden />
        <XlsxLargeLabel>{pictureLabel}</XlsxLargeLabel>
      </XlsxLargeButton>
      <XlsxVisualMenu
        id="shape"
        labelKey="office.xlsx.visuals.shape.insert"
        icon={Shapes}
        blocked={blocked}
        blockedReason={pending}
        entries={SHAPE_TYPES.map(({ type, icon }) => ({
          id: type,
          icon,
          label: t(`office.xlsx.visuals.shapeTypes.${type}`),
          onSelect: () => visuals?.insertShape(type),
        }))}
      />
    </XlsxGroupBody>
  );
}
