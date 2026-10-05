"use client";

import type { ReactNode, Ref } from "react";
import { cn } from "@uniwork/ui/lib/utils";

export interface OfficeFrameProps {
  /** `<OfficeRibbon>`; the band itself owns its surface and bottom border. */
  ribbon?: ReactNode;
  /** Full-width rows between the ribbon and the canvas: ruler, formula bar, find bar. */
  subbar?: ReactNode;
  /** Left rail inside the canvas row (slides, pdf thumbnails). */
  rail?: ReactNode;
  /** Right pane inside the canvas row (navigation, comments). */
  aside?: ReactNode;
  /** Inside the canvas column, under the canvas (pptx notes, xlsx sheet tabs). */
  bottom?: ReactNode;
  statusBar?: ReactNode;
  /** Canvas content. */
  children: ReactNode;
  canvasRef?: Ref<HTMLDivElement>;
  canvasClassName?: string;
  className?: string;
  "data-testid"?: string;
}

/**
 * The one editor frame every Office format mounts into: ribbon, sub-bars, a
 * row of [rail | canvas | aside] and a status bar, edge to edge. Absent slots
 * render nothing, so a format never carries an empty row.
 */
export function OfficeFrame({
  ribbon,
  subbar,
  rail,
  aside,
  bottom,
  statusBar,
  children,
  canvasRef,
  canvasClassName,
  className,
  "data-testid": testId,
}: OfficeFrameProps) {
  return (
    <div
      className={cn("flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-office-canvas font-sans", className)}
      data-office-frame
      data-testid={testId}
    >
      {ribbon}
      {subbar}
      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        {rail}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            ref={canvasRef}
            className={cn("min-h-0 min-w-0 flex-1 overflow-auto bg-office-canvas", canvasClassName)}
            data-office-canvas
          >
            {children}
          </div>
          {bottom}
        </div>
        {aside}
      </div>
      {statusBar}
    </div>
  );
}
