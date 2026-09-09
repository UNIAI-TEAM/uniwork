import type { ReactNode } from "react";

export function RichContent(props: {
  children?: ReactNode;
  content?: string;
  attachments?: unknown;
  density?: string;
  phase?: string;
  className?: string;
  [key: string]: unknown;
}) {
  const { content, children, className } = props;
  return <div className={className ?? "prose text-body"}>{children ?? content}</div>;
}
