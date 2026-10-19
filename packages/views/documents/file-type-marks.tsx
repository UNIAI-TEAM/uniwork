"use client";

import { useId } from "react";
import { cn } from "@uniwork/ui/lib/utils";
import { UniNoteIcon } from "./uninote-icon";

// The file-type marks of UniWork Office (genoffice shell assets
// apps/shell/src/renderer/src/assets/file-*.svg), inlined once so the web and
// the desktop app show the same artwork. They are product marks, like
// ../common/provider-icons.tsx: their colours are the marks', not theme slots.
// The page mark is the UniNote tile (Documents design, 2026-10-16): the glyph
// in the blue tint pair, so it follows the theme.

interface MarkProps {
  className?: string;
}

export const FILE_MARK_FORMATS = ["page", "docx", "xlsx", "pptx", "md", "html", "pdf"] as const;
export type FileMarkFormat = (typeof FILE_MARK_FORMATS)[number];

export function isFileMarkFormat(value: string | null | undefined): value is FileMarkFormat {
  return (FILE_MARK_FORMATS as readonly string[]).includes(value ?? "");
}

/** One decorative mark; the caller names it (the icon is aria-hidden). */
export function FileTypeMark({ format, className }: { format: FileMarkFormat; className?: string }) {
  switch (format) {
    case "docx":
      return <DocxMark className={className} />;
    case "xlsx":
      return <XlsxMark className={className} />;
    case "pptx":
      return <PptxMark className={className} />;
    case "md":
      return <MdMark className={className} />;
    case "html":
      return <HtmlMark className={className} />;
    case "pdf":
      return <PdfMark className={className} />;
    default:
      return <PageMark className={className} />;
  }
}

function DocxMark({ className }: MarkProps) {
  return (
    <svg aria-hidden focusable="false" className={className} viewBox="24 24 240 240" fill="none">
    <rect x="24" y="24" width="240" height="240" rx="48" fill="#3276CD"/>
    <path d="M207.373 96H196.927C192.749 96 189.267 98.4 188.57 102C173.946 160.8 174.642 159 173.946 163.8C173.946 163.2 173.946 162.6 173.249 161.4C172.553 158.4 173.946 161.4 157.232 102C155.839 98.4 153.053 96 148.875 96H139.822C135.643 96 132.161 98.4 131.465 102C114.751 161.4 114.751 159.6 114.054 163.8V161.4C113.358 158.4 104.305 117.6 100.823 102C99.4299 98.4 96.6442 96 92.4658 96H80.6268C75.0556 96 70.8771 100.8 72.2699 105C77.8412 124.8 91.073 171 95.2514 186.6C96.6442 190.2 100.126 192 103.608 192H121.019C125.197 192 128.679 190.2 129.375 186.6L141.911 144L144 138L146.089 144C146.089 144 154.446 174 158.625 186.6C159.321 189.6 162.803 192 166.285 192H183.695C187.177 192 190.659 190.2 192.052 186.6C205.98 137.4 212.944 115.2 215.73 105C217.123 100.8 212.944 96 207.373 96Z" fill="white"/>
    </svg>
  );
}

function XlsxMark({ className }: MarkProps) {
  return (
    <svg aria-hidden focusable="false" className={className} viewBox="0 0 240 240" fill="none">
    <rect width="240" height="240" rx="48" fill="#4FA16B"/>
    <path d="M96.3863 61.8047C98.5543 61.8052 100.377 63.1591 101.332 65.1562L101.367 65.2148C114.487 90.1591 110.279 82.597 118.664 100.758L120.445 104.637L121.98 100.641C125.532 91.3552 127.882 85.7897 138.621 65.2031L137.031 64.373L138.632 65.2031L138.656 65.1562C139.61 63.1599 141.434 61.8064 143.601 61.8047H160.933C164.595 61.8047 167.33 65.8991 165.75 69.5977L165.375 70.3242L165.339 70.3828C160.568 79.1142 153.7 91.1365 148.019 101.062C145.182 106.02 142.633 110.459 140.8 113.695C139.885 115.311 139.148 116.643 138.632 117.586C138.378 118.052 138.169 118.436 138.023 118.723C137.951 118.864 137.877 119.002 137.824 119.121C137.799 119.178 137.772 119.259 137.742 119.344C137.727 119.386 137.704 119.452 137.683 119.531C137.669 119.588 137.625 119.77 137.625 120V120.469L137.859 120.879L165.351 169.629L165.375 169.676C167.682 173.542 164.837 178.195 160.933 178.195H143.601C141.455 178.194 139.917 177.443 139.007 176.086L138.656 175.477L138.621 175.418L131.425 161.473C126.778 152.195 128.26 153.91 121.945 139.289L120.316 135.504L118.652 139.277C115.953 145.392 114.95 148.635 109.089 160.395L101.367 175.406L101.332 175.477C100.498 177.217 98.8376 178.195 96.3863 178.195H79.6519C75.0237 178.195 72.3782 173.434 74.6246 169.676L74.6363 169.629L102.14 120.879L102.632 120L102.14 119.121L74.6832 70.4648C73.747 68.4964 73.8839 66.2974 74.8003 64.6172C75.6999 62.9712 77.3618 61.8048 79.6519 61.8047H96.3863Z" fill="white"/>
    </svg>
  );
}

function PptxMark({ className }: MarkProps) {
  return (
    <svg aria-hidden focusable="false" className={className} viewBox="24 24 240 240" fill="none">
    <rect x="24" y="24" width="240" height="240" rx="48" fill="#D33922"/>
    <path d="M154.5 96C176.5 96 191 111.75 191 133.898C191 178.195 146.5 171.797 135 171.797V199.852C135 203.297 132.5 205.758 129 205.758H114C110.5 205.758 108 203.297 108 199.852V101.906C108 98.4609 110.5 96 114 96H154.5ZM135 148.664H148.5C153 148.664 156.5 147.188 159 144.727C164 138.82 164 128.484 159.5 123.07C157 120.117 153.5 119.133 149 119.133H135V148.664Z" fill="white"/>
    </svg>
  );
}

function MdMark({ className }: MarkProps) {
  const uid = useId();
  return (
    <svg aria-hidden focusable="false" className={className} viewBox="0 0 240 240" fill="none">
    <g clipPath={`url(#${uid})`}>
    <path d="M48 240L192 240C218.51 240 240 218.51 240 192L240 48C240 21.4903 218.51 1.91027e-05 192 1.67852e-05L48 4.19629e-06C21.4903 1.87874e-06 1.91027e-05 21.4903 1.67852e-05 48L4.19629e-06 192C1.87874e-06 218.51 21.4903 240 48 240Z" fill="#8B5CF6"/>
    <path d="M36.4103 164L44.1723 164C47.2768 164 49.8641 161.8 50.382 158.5C61.2484 104.6 60.7313 106.25 61.2484 101.85C61.2484 102.4 62 98.9167 63.5 101.85C64.5 105.792 61.2484 92.1333 73.6679 146.583C74.7029 149.883 76.7731 152.083 79.8776 152.083L86.6045 152.083C89.7097 152.083 92.297 149.883 92.8142 146.583C103.693 98.8889 103.329 99.9343 104.415 100.62C104.569 100.717 104.752 100.807 105 100.75L105.752 104.05C106.269 106.8 112.996 144.2 115.583 158.5C116.618 161.8 118.688 164 121.793 164L130.59 164C134.729 164 137.834 159.6 136.799 155.75C132.66 137.6 122.828 95.25 119.723 80.95C118.688 77.65 116.101 76 113.513 76L100.576 76C97.4717 76 94.8843 77.65 94.3672 80.95L85.0522 120L83.5 125.5L81.9477 120C81.9477 120 75.738 92.5 72.6328 80.95C72.1156 78.2 69.5283 76 66.941 76L54.0044 76C51.4171 76 48.8298 77.65 47.7947 80.95C37.4454 126.05 32.2708 146.4 30.2006 155.75C29.1655 159.6 32.2708 164 36.4103 164Z" fill="white"/>
    <path d="M168 82C168 78.6863 170.686 76 174 76H184C187.314 76 190 78.6863 190 82V142H168V82Z" fill="white"/>
    <path d="M175.248 162.741C177.239 165.001 180.761 165.001 182.752 162.741L208.684 133.305C211.528 130.076 209.236 125 204.932 125H153.068C148.765 125 146.472 130.076 149.316 133.305L175.248 162.741Z" fill="white"/>
    </g>
    <defs>
    <clipPath id={uid}>
    <rect width="240" height="240" fill="white" transform="translate(240 240) rotate(-180)"/>
    </clipPath>
    </defs>
    </svg>
  );
}

function HtmlMark({ className }: MarkProps) {
  return (
    <svg aria-hidden focusable="false" className={className} viewBox="0 0 240 240" fill="none">
    <rect width="240" height="240" rx="48" fill="#0FA3A3"/>
    <path d="M92 72L44 120L92 168M148 72L196 120L148 168" stroke="white" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function PdfMark({ className }: MarkProps) {
  return (
    <svg aria-hidden focusable="false" className={className} viewBox="0 0 240 240" fill="none">
    <rect width="240" height="240" rx="48" fill="#EF4444"/>
    <path d="M102.719 63.0153C105.738 52.1477 126.265 50.9398 128.68 66.6374C131.699 75.6938 127.472 90.7878 125.661 100.448C130.491 113.127 137.133 122.183 147.397 128.22C158.264 127.013 179.395 125.202 186.641 132.447C192.678 138.485 191.471 155.389 175.774 155.389C166.717 155.389 153.434 151.767 141.963 145.126C129.284 147.541 114.19 152.974 100.907 157.804C70.7196 209.727 53.2104 186.181 55.0216 176.521C57.4366 164.446 73.7385 154.786 85.8136 148.749C91.8511 137.277 100.907 117.957 106.944 103.466C102.718 86.5617 100.304 72.6754 102.719 63.0153ZM85.2149 158.437C81.5921 161.456 70.1214 171.117 67.1026 179.569C67.1026 179.569 73.7436 176.55 85.2149 158.437ZM116.605 113.718C112.378 124.586 107.548 136.662 101.511 146.925C111.171 142.699 122.039 137.869 134.718 134.85C127.473 130.02 121.435 122.775 116.605 113.718ZM180.613 143.932C183.028 142.121 179.406 137.291 158.275 139.102C177.595 147.555 180.613 143.932 180.613 143.932ZM116.013 64.2419C114.805 64.2436 114.806 80.5436 117.221 88.9958C120.239 83.5616 120.843 64.2421 116.013 64.2419Z" fill="white"/>
    </svg>
  );
}

/** The UniNote tile: the glyph in the blue tint pair, legible in both modes. */
function PageMark({ className }: MarkProps) {
  return (
    <span className={cn("flex items-center justify-center rounded-[20%] bg-tint-blue text-tint-blue-foreground", className)}>
      <UniNoteIcon className="size-[70%]" />
    </span>
  );
}
