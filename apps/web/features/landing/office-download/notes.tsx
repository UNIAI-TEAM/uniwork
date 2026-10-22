import type { ReactNode } from "react";

/**
 * Release notes are untrusted markdown. This renderer builds React elements
 * only (never HTML), knows headings, lists, paragraphs, bold, code and links,
 * and links only to this site: any other address stays plain text.
 */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function ownLink(href: string): boolean {
  return /^\/(?!\/)/.test(href) || /^https:\/\/uniworkos\.com(?:[/?#]|$)/.test(href);
}

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const id = `${key}-${index}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={id}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={id}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) return ownLink(link[2]!) ? <a key={id} href={link[2]}>{link[1]}</a> : <span key={id}>{link[1]}</span>;
    return part;
  });
}

export function ReleaseNotes({ markdown, className }: { markdown: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];
  const flush = () => {
    const key = `b${blocks.length}`;
    if (paragraph.length > 0) blocks.push(<p key={key}>{inline(paragraph.join(" "), key)}</p>);
    if (list) {
      const items = list.items.map((item, index) => <li key={index}>{inline(item, `${key}-${index}`)}</li>);
      blocks.push(list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
    }
    paragraph = [];
    list = null;
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    const item = /^\s*(?:([-*])|(\d+)\.)\s+(.+)$/.exec(line);
    if (heading) { flush(); blocks.push(<h4 key={`b${blocks.length}`}>{inline(heading[1]!, `h${blocks.length}`)}</h4>); }
    else if (item) {
      const ordered = item[2] !== undefined;
      if (list && list.ordered !== ordered) flush();
      if (paragraph.length > 0) flush();
      list = list ?? { ordered, items: [] };
      list.items.push(item[3]!);
    } else if (line.trim() === "") flush();
    else { if (list) flush(); paragraph.push(line.trim()); }
  }
  flush();
  return <div className={className ? `office-dl-notes-md ${className}` : "office-dl-notes-md"}>{blocks}</div>;
}
