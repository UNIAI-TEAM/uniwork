"use client";
import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MeetingEvidenceRef } from "@uniwork/core/types/meeting";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingPersonAvatar } from "../../meeting-person";
import { meetingAvatarTint } from "../avatar-tint";
import { EvidenceTimeChip } from "../overview/evidence-chip";
import { TimeChipButton, TimeChipMore } from "../ui/time-chip";
import { TimeGutterRow } from "../ui/time-row";
import { children, docLayout, isAiSection, nodeText, sameText, splitTimes, type DocNode } from "./minutes-model";

/** Summary text → its evidence; `more` draws the "+n" (decisions — the board's questions carry the chip alone). */
export type MinutesEvidence = ReadonlyMap<string, { refs: readonly MeetingEvidenceRef[]; more: boolean }>;

type Person = { user_id: string; display_name: string; avatar_url?: unknown };

type Ctx = {
  meetingId: string;
  evidence: MinutesEvidence;
  /** Opens the transcript from a page time; absent → the time is plain text. */
  onTime?: () => void;
  people: readonly Person[];
  byName: ReadonlyMap<string, Person>;
};

const BULLETS = "flex max-w-150 flex-col gap-1.5";
const BULLET =
  "relative pl-4.5 text-body-lg before:absolute before:top-2.5 before:left-1 before:size-1 before:rounded-full before:bg-current before:opacity-70";

/**
 * Read-only preview of the minutes page (kit AfterMinutes `.doc`): the
 * properties grid, one reading column of real headings, topic and decision
 * rows on the 56 time gutter, the assigned-tasks table and the closing line.
 * AI prose (the Nội dung section's text and topic points) is muted until the
 * minutes are finalized (brief Principle 4).
 */
export function MinutesDocument({
  content,
  finalized,
  meetingId,
  evidence,
  onTime,
  people,
}: {
  content: unknown;
  finalized: boolean;
  meetingId: string;
  evidence: MinutesEvidence;
  onTime?: () => void;
  people: readonly Person[];
}) {
  const { t } = useTranslation();
  const { props, sections, foot } = docLayout(content);
  const ctx: Ctx = { meetingId, evidence, onTime, people, byName: new Map(people.map((p) => [p.display_name, p])) };
  return (
    <article aria-label={t("meetings.detail.minutes.docLabel")} className="mt-6">
      {props ? (
        <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-y-1">
          {props.map((p) => (
            <div key={p.label} className="contents">
              <dt className="text-caption leading-5 text-muted-foreground">{p.label}</dt>
              <dd className="flex items-center gap-1.5 text-body">
                <PropValue value={p.value} ctx={ctx} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {sections.map((section, i) => {
        const title = section.heading ? nodeText(section.heading) : "";
        const muted = !finalized && isAiSection(title);
        return (
          // id + data-outline: the rail's "Trên trang này" lists the document's sections (AfterMinutes).
          <section key={i} id={`minutes-sec-${i}`} data-outline={title || undefined} className="mt-10 scroll-mt-6 first:mt-0">
            {section.heading ? <h3 className="text-title-sm font-semibold">{inline(section.heading)}</h3> : null}
            <Blocks nodes={section.blocks} muted={muted} ctx={ctx} />
          </section>
        );
      })}
      {foot ? (
        <p className="mt-6 max-w-170 border-t border-border pt-3 text-caption text-muted-foreground">{inline(foot)}</p>
      ) : null}
    </article>
  );
}

function Blocks({ nodes, muted, ctx }: { nodes: DocNode[]; muted: boolean; ctx: Ctx }) {
  const out: ReactNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const prev = nodes[i - 1];
    const gap = !prev ? "mt-3" : prev.type === "paragraph" && isList(node) ? "mt-2" : "mt-3";
    if (node.type === "heading") {
      // A topic: "Rà soát việc tồn tuần trước (lúc 09:01)" over its points.
      const { text, times } = splitTimes(nodeText(node));
      const next = nodes[i + 1];
      const points = next && isList(next) ? next : null;
      if (points) i++;
      out.push(
        <div key={i} className="mt-5">
          <h4 className="grid grid-cols-[56px_minmax(0,1fr)] items-start text-body-lg font-semibold @max-[37.5rem]/meeting:grid-cols-[52px_minmax(0,1fr)]">
            <span className="-ml-1.5 mt-px flex justify-self-start">
              {times[0] ? <PageTime time={times[0]} ctx={ctx} /> : null}
            </span>
            <span className="min-w-0">{text}</span>
          </h4>
          {points ? (
            <ul className={cn(BULLETS, "mt-1.5 max-w-164 pl-14 @max-[37.5rem]/meeting:pl-0", muted && "text-muted-foreground")}>
              {children(points).map((item, j) => (
                <li key={j} className={BULLET}>
                  {itemInline(item)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>,
      );
    } else if (isList(node)) {
      out.push(<List key={i} node={node} muted={muted} ctx={ctx} className={gap} />);
    } else if (node.type === "table") {
      out.push(<Table key={i} node={node} ctx={ctx} className={gap} />);
    } else if (node.type === "horizontalRule") {
      out.push(<hr key={i} className={cn(gap, "max-w-170 border-border")} />);
    } else {
      out.push(
        <p key={i} className={cn(gap, "max-w-150 text-body-lg", muted && "text-muted-foreground")}>
          {inline(node)}
        </p>,
      );
    }
  }
  return <>{out}</>;
}

function isList(node: DocNode): boolean {
  return node.type === "bulletList" || node.type === "orderedList";
}

/** A list whose items carry a page time or a summary match reads as time rows; any other as bullets. */
function List({ node, muted, ctx, className }: { node: DocNode; muted: boolean; ctx: Ctx; className: string }) {
  const items = children(node).map((item) => {
    const split = splitTimes(nodeText(item));
    return { item, ...split, known: ctx.evidence.get(sameText(split.text)) };
  });
  if (!items.some((it) => it.times.length > 0 || it.known)) {
    return (
      <ul className={cn(BULLETS, className, muted && "text-muted-foreground")}>
        {items.map(({ item }, j) => (
          <li key={j} className={BULLET}>
            {itemInline(item)}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ol className={cn("flex flex-col gap-2.5", className, muted && "text-muted-foreground")}>
      {items.map(({ text, times, known }, j) => {
        const more = known ? (known.more ? known.refs.length - 1 : 0) : times.length - 1;
        return (
          <TimeGutterRow
            key={j}
            // shortcut: the chip's gutter span is a line box until ui/time-row.tsx draws it as flex; drop then.
            className="[&>span]:flex"
            time={
              known ? (
                <EvidenceTimeChip meetingId={ctx.meetingId} refs={known.refs} time={times[0]} />
              ) : times[0] ? (
                <PageTime time={times[0]} ctx={ctx} />
              ) : undefined
            }
          >
            {text}
            <TimeChipMore count={more} />
          </TimeGutterRow>
        );
      })}
    </ol>
  );
}

/** A time written in the page: a chip into the transcript, or plain mono text where there is none. */
function PageTime({ time, ctx }: { time: string; ctx: Ctx }) {
  const { t } = useTranslation();
  if (!ctx.onTime) return <time className="ml-1.5 font-mono text-caption font-medium text-muted-foreground">{time}</time>;
  return <TimeChipButton time={time} ariaLabel={t("meetings.detail.ui.evidenceAt", { time })} onClick={ctx.onTime} />;
}

function Table({ node, ctx, className }: { node: DocNode; ctx: Ctx; className: string }) {
  const rows = children(node);
  const head = rows[0] && children(rows[0]).every((c) => c.type === "tableHeader") ? rows[0] : null;
  const labels = head ? children(head).map(nodeText) : [];
  const body = head ? rows.slice(1) : rows;
  const edge = "last:pr-0 last:text-right last:whitespace-nowrap";
  // On a phone each row is a grid: the task across, then the person and the due date (the hidden head too).
  const phoneRow =
    "@max-[37.5rem]/meeting:grid @max-[37.5rem]/meeting:grid-cols-[auto_minmax(0,1fr)] @max-[37.5rem]/meeting:items-center @max-[37.5rem]/meeting:gap-x-2 @max-[37.5rem]/meeting:gap-y-1 @max-[37.5rem]/meeting:border-t @max-[37.5rem]/meeting:border-border @max-[37.5rem]/meeting:py-2.5";
  return (
    <table className={cn("w-full max-w-170 border-collapse", className)}>
      {head ? (
        <thead className="@max-[37.5rem]/meeting:sr-only">
          <tr className={phoneRow}>
            {labels.map((label, j) => (
              <th key={j} scope="col" className={cn("pr-4 pb-2 text-left text-caption font-normal text-muted-foreground", edge)}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
      ) : null}
      <tbody className="@max-[37.5rem]/meeting:block">
        {body.map((row, r) => (
          <tr key={r} className={phoneRow}>
            {children(row).map((cell, j) => {
              const text = nodeText(cell);
              const person = ctx.byName.get(text.trim());
              return (
                <td
                  key={j}
                  // On a phone the header row is hidden, so a non-person cell says its column ("Hạn 26/10/2026").
                  data-label={j > 0 && !person ? labels[j] : undefined}
                  className={cn(
                    "border-t border-border py-2.5 pr-4 align-top text-body",
                    // Figures line up in the value columns only (kit `.num`); tnum on the task text shifts its glyphs.
                    j > 0 && !person && "tabular-nums",
                    edge,
                    "@max-[37.5rem]/meeting:block @max-[37.5rem]/meeting:border-t-0 @max-[37.5rem]/meeting:p-0 @max-[37.5rem]/meeting:text-left @max-[37.5rem]/meeting:last:text-left",
                    j === 0
                      ? "@max-[37.5rem]/meeting:col-span-full"
                      : "@max-[37.5rem]/meeting:text-caption @max-[37.5rem]/meeting:text-muted-foreground @max-[37.5rem]/meeting:data-label:before:mr-1 @max-[37.5rem]/meeting:data-label:before:content-[attr(data-label)]",
                  )}
                >
                  {person ? (
                    <span className="mb-px flex w-fit items-center gap-1.5 whitespace-nowrap @max-[37.5rem]/meeting:mb-0">
                      <PersonName name={text.trim()} ctx={ctx} />
                    </span>
                  ) : (
                    inline(cell)
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TIME_RANGE = /^(\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2})(.*)$/;

/** A property's value: a member with their avatar, a time range as `<time>`, any other text as it is. */
function PropValue({ value, ctx }: { value: string; ctx: Ctx }) {
  const range = TIME_RANGE.exec(value);
  if (!ctx.byName.has(value) && range) {
    return (
      <span>
        <time>{range[1]}</time>
        {range[2]}
      </span>
    );
  }
  return <PersonName name={value} ctx={ctx} plain />;
}

/** A member's name with their 20 avatar (`plain`: the name as a bare text run beside it); any other text as it is. */
function PersonName({ name, ctx, plain = false }: { name: string; ctx: Ctx; plain?: boolean }) {
  const person = ctx.byName.get(name);
  if (!person) return <span>{name}</span>;
  return (
    <>
      <MeetingPersonAvatar
        name={person.display_name}
        avatarUrl={person.avatar_url}
        size={20}
        tint={meetingAvatarTint(person.user_id, ctx.people)}
      />
      {plain ? name : <span>{name}</span>}
    </>
  );
}

/** A list item's paragraphs inline; nested lists as plain text after them. */
function itemInline(item: DocNode): ReactNode {
  return children(item).map((block, k) =>
    block.type === "paragraph" ? <Fragment key={k}>{inline(block)}</Fragment> : <span key={k}> {nodeText(block)}</span>,
  );
}

const SAFE_HREF = /^https?:\/\//i;

/**
 * A block's text runs with their marks (bold, italic, strike, code, http links). Plain runs stay bare text
 * in the block (a cell's paragraphs too), so the block itself carries the line box.
 */
function inline(node: DocNode): ReactNode {
  return children(node).map((leaf, k) => {
    if (leaf.type === "hardBreak") return <br key={k} />;
    if (leaf.type === "paragraph") return <Fragment key={k}>{inline(leaf)}</Fragment>;
    if (leaf.type !== "text") return <span key={k}>{nodeText(leaf)}</span>;
    if (!leaf.marks?.length) return <Fragment key={k}>{leaf.text ?? ""}</Fragment>;
    let out: ReactNode = leaf.text ?? "";
    for (const mark of leaf.marks ?? []) {
      if (mark.type === "bold") out = <strong className="font-semibold">{out}</strong>;
      else if (mark.type === "italic") out = <em>{out}</em>;
      else if (mark.type === "strike") out = <s>{out}</s>;
      else if (mark.type === "code") out = <code className="font-mono">{out}</code>;
      else if (mark.type === "link" && typeof mark.attrs?.href === "string" && SAFE_HREF.test(mark.attrs.href)) {
        out = (
          <a href={mark.attrs.href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
            {out}
          </a>
        );
      }
    }
    return <Fragment key={k}>{out}</Fragment>;
  });
}
