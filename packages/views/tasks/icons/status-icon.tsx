import type { ReactNode } from "react";
import type { TaskStatus } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import { STATUS_CONFIG } from "../modes/status-config";

const CENTER = 7;
const OUTER_RADIUS = 6;
const FILL_RADIUS = 3.5;

function piePath(progress: number): string {
  const angle = 2 * Math.PI * progress;
  const endX = CENTER + FILL_RADIUS * Math.sin(angle);
  const endY = CENTER - FILL_RADIUS * Math.cos(angle);
  const largeArc = progress > 0.5 ? 1 : 0;
  return `M${CENTER},${CENTER} L${CENTER},${CENTER - FILL_RADIUS} A${FILL_RADIUS},${FILL_RADIUS} 0 ${largeArc},1 ${endX},${endY} Z`;
}

function ProgressCircle({ progress, children }: { progress: number; children?: ReactNode }) {
  return (
    <>
      <circle
        cx={CENTER}
        cy={CENTER}
        r={OUTER_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeDasharray="3.14 0"
        strokeDashoffset={-0.7}
      />
      {progress === 1 ? (
        <circle cx={CENTER} cy={CENTER} r={OUTER_RADIUS} fill="currentColor" />
      ) : progress > 0 ? (
        <path d={piePath(progress)} fill="currentColor" />
      ) : null}
      {children}
    </>
  );
}

function BacklogIcon() {
  return (
    <g>
      {Array.from({ length: 16 }, (_, index) => {
        const angle = (index / 16) * Math.PI * 2 - Math.PI / 2;
        return (
          <circle
            key={index}
            cx={CENTER + OUTER_RADIUS * Math.cos(angle)}
            cy={CENTER + OUTER_RADIUS * Math.sin(angle)}
            r={0.55}
            fill="currentColor"
          />
        );
      })}
    </g>
  );
}

function DoneIcon() {
  return (
    <ProgressCircle progress={1}>
      <path
        d="M10.951 4.24896C11.283 4.58091 11.283 5.11909 10.951 5.45104L5.95104 10.451C5.61909 10.783 5.0809 10.783 4.74896 10.451L2.74896 8.45104C2.41701 8.11909 2.41701 7.5809 2.74896 7.24896C3.0809 6.91701 3.61909 6.91701 3.95104 7.24896L5.35 8.64792L9.74896 4.24896C10.0809 3.91701 10.6191 3.91701 10.951 4.24896Z"
        fill="white"
        stroke="none"
      />
    </ProgressCircle>
  );
}

function BlockedIcon() {
  return (
    <ProgressCircle progress={0}>
      <line
        x1={CENTER + FILL_RADIUS * Math.cos(Math.PI * 0.75)}
        y1={CENTER - FILL_RADIUS * Math.sin(Math.PI * 0.75)}
        x2={CENTER + FILL_RADIUS * Math.cos(-Math.PI * 0.25)}
        y2={CENTER - FILL_RADIUS * Math.sin(-Math.PI * 0.25)}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </ProgressCircle>
  );
}

function CancelledIcon() {
  return (
    <ProgressCircle progress={0}>
      <path
        d="M5 5 L9 9 M9 5 L5 9"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </ProgressCircle>
  );
}

const renderers: Record<TaskStatus, () => ReactNode> = {
  backlog: BacklogIcon,
  todo: () => <ProgressCircle progress={0} />,
  in_progress: () => <ProgressCircle progress={0.5} />,
  in_review: () => <ProgressCircle progress={0.75} />,
  done: DoneIcon,
  blocked: BlockedIcon,
  cancelled: CancelledIcon,
};

function categoryOf(status: string): TaskStatus {
  return status in renderers ? (status as TaskStatus) : "todo";
}

export function StatusIcon({
  status,
  category: categoryProp,
  color,
  className,
  inheritColor = false,
}: {
  status: string;
  /** Catalog category key; unknown values fall back via categoryOf. */
  category?: string;
  color?: string | null;
  className?: string;
  inheritColor?: boolean;
}) {
  const category = categoryOf(categoryProp ?? status);
  const Renderer = renderers[category];
  const customColor = !inheritColor && Boolean(color);

  return (
    <svg
      aria-hidden
      data-slot="status-icon"
      viewBox="0 0 14 14"
      fill="none"
      style={customColor ? { color: color ?? undefined } : undefined}
      className={cn(
        "size-4 shrink-0",
        !inheritColor && !customColor && STATUS_CONFIG[category].iconColor,
        className,
      )}
    >
      <Renderer />
    </svg>
  );
}
