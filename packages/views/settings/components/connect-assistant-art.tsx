"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export type ArtKind = "openClaude" | "openChatgpt" | "addClaude" | "addChatgpt" | "allow";

const ALT: Record<ArtKind, string> = {
  openClaude: "artOpenClaude",
  openChatgpt: "artOpenChatgpt",
  addClaude: "artAddClaude",
  addChatgpt: "artAddChatgpt",
  allow: "artAllow",
};

/**
 * The assistants' own labels, as their apps show them (checked 2026-10). Not
 * translated: the user matches them against an English screen. They drift
 * with each redesign, so the steps' text and these drawings change together.
 */
const UI = {
  claudeHost: "claude.ai",
  chatgptHost: "chatgpt.com",
  customize: "Customize",
  connectors: "Connectors",
  plusAdd: "+ Add",
  addCustom: "Add custom connector",
  name: "Name",
  url: "URL",
  add: "Add",
  settings: "Settings",
  apps: "Apps",
  advanced: "Advanced settings",
  devMode: "Developer mode",
  createApp: "Create app",
  serverUrl: "MCP server URL",
  auth: "Authentication",
  oauth: "OAuth",
  create: "Create",
  uniwork: "UniWork",
} as const;

const W = 360;
const H = 200;

/** A browser window: the frame every scene is drawn in. */
function Window({ host, children }: { host: string; children: ReactNode }) {
  return (
    <>
      <rect x={6} y={6} width={W - 12} height={H - 12} rx={10} className="fill-background stroke-border" />
      <path d={`M6 30 H${W - 6}`} className="stroke-border" />
      {[18, 30, 42].map((cx) => (
        <circle key={cx} cx={cx} cy={18} r={3.5} className="fill-muted-foreground/40" />
      ))}
      <rect x={110} y={11} width={140} height={14} rx={7} className="fill-muted" />
      <text x={180} y={21.5} textAnchor="middle" fontSize={9} className="fill-muted-foreground">
        {host}
      </text>
      {children}
    </>
  );
}

/** A grey line standing for text the user need not read. */
const Bar = ({ x, y, w }: { x: number; y: number; w: number }) => (
  <rect x={x} y={y} width={w} height={6} rx={3} className="fill-muted" />
);

/** The thing to look at: a primary ring the eye lands on. */
const Ring = ({ x, y, w, h }: { x: number; y: number; w: number; h: number }) => (
  <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={7} strokeWidth={2} className="fill-primary/10 stroke-primary" />
);

function Label({ x, y, children, strong = false }: { x: number; y: number; children: ReactNode; strong?: boolean }) {
  return (
    <text x={x} y={y} fontSize={10} fontWeight={strong ? 600 : 400} className="fill-foreground">
      {children}
    </text>
  );
}

function Field({ x, y, w, label, value, ring = false }: { x: number; y: number; w: number; label: string; value: string; ring?: boolean }) {
  return (
    <>
      <text x={x} y={y} fontSize={9} className="fill-muted-foreground">
        {label}
      </text>
      {ring ? <Ring x={x} y={y + 5} w={w} h={18} /> : null}
      <rect x={x} y={y + 5} width={w} height={18} rx={4} className="fill-background stroke-border" />
      <text x={x + 6} y={y + 17.5} fontSize={9.5} className="fill-foreground">
        {value}
      </text>
    </>
  );
}

function Pill({ x, y, w, children, primary = false }: { x: number; y: number; w: number; children: ReactNode; primary?: boolean }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={20} rx={6} className={primary ? "fill-primary" : "fill-background stroke-border"} />
      <text x={x + w / 2} y={y + 13.5} textAnchor="middle" fontSize={9.5} fontWeight={600} className={primary ? "fill-primary-foreground" : "fill-foreground"}>
        {children}
      </text>
    </>
  );
}

/** A small dialog over the dimmed app: where both assistants ask for the address. */
function Sheet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <rect x={7} y={31} width={W - 14} height={H - 38} className="fill-muted/60" />
      <rect x={70} y={40} width={220} height={148} rx={8} className="fill-background stroke-border" />
      <Label x={82} y={58} strong>
        {title}
      </Label>
      {children}
    </>
  );
}

function OpenClaude() {
  return (
    <Window host={UI.claudeHost}>
      <path d={`M100 30 V${H - 6}`} className="stroke-border" />
      <Bar x={18} y={46} w={60} />
      <Bar x={18} y={62} w={48} />
      <Ring x={16} y={74} w={76} h={18} />
      <Label x={20} y={87} strong>
        {UI.customize}
      </Label>
      <Label x={116} y={52} strong>
        {UI.connectors}
      </Label>
      <Pill x={W - 70} y={40} w={52}>
        {UI.plusAdd}
      </Pill>
      {[70, 94, 118, 142].map((y) => (
        <g key={y}>
          <rect x={116} y={y} width={W - 140} height={18} rx={4} className="fill-muted/50" />
          <Bar x={124} y={y + 6} w={90} />
        </g>
      ))}
    </Window>
  );
}

function OpenChatgpt() {
  return (
    <Window host={UI.chatgptHost}>
      <Label x={20} y={50} strong>
        {UI.settings}
      </Label>
      <Bar x={20} y={64} w={56} />
      <Ring x={18} y={76} w={72} h={18} />
      <Label x={22} y={89}>
        {UI.apps}
      </Label>
      <Bar x={20} y={106} w={50} />
      <path d={`M100 30 V${H - 6}`} className="stroke-border" />
      <Label x={116} y={52} strong>
        {UI.advanced}
      </Label>
      <Bar x={116} y={66} w={150} />
      <Ring x={116} y={82} w={W - 140} h={22} />
      <Label x={122} y={97}>
        {UI.devMode}
      </Label>
      <rect x={W - 58} y={86} width={28} height={14} rx={7} className="fill-primary" />
      <circle cx={W - 37} cy={93} r={5} className="fill-primary-foreground" />
    </Window>
  );
}

function AddClaude({ url }: { url: string }) {
  return (
    <Window host={UI.claudeHost}>
      <Sheet title={UI.addCustom}>
        <Field x={82} y={78} w={196} label={UI.name} value={UI.uniwork} />
        <Field x={82} y={118} w={196} label={UI.url} value={url} ring />
        <Pill x={232} y={160} w={46} primary>
          {UI.add}
        </Pill>
      </Sheet>
    </Window>
  );
}

function AddChatgpt({ url }: { url: string }) {
  return (
    <Window host={UI.chatgptHost}>
      <Sheet title={UI.createApp}>
        <Field x={82} y={70} w={196} label={UI.name} value={UI.uniwork} />
        <Field x={82} y={106} w={196} label={UI.serverUrl} value={url} ring />
        <Field x={82} y={145} w={92} label={UI.auth} value={UI.oauth} />
        <Pill x={222} y={160} w={56} primary>
          {UI.create}
        </Pill>
      </Sheet>
    </Window>
  );
}

/** UniWork's own consent page, so its labels come from the same keys the page uses. */
function Allow({ host, client }: { host: string; client: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.connect" });
  return (
    <Window host={host}>
      <rect x={60} y={40} width={240} height={148} rx={8} className="fill-background stroke-border" />
      <Label x={74} y={60} strong>
        {t("title", { client })}
      </Label>
      <Bar x={74} y={72} w={200} />
      <Bar x={74} y={86} w={170} />
      <rect x={74} y={106} width={12} height={12} rx={3} className="fill-primary" />
      <path d="M77 112 l3 3 l5 -6" fill="none" strokeWidth={1.8} className="stroke-primary-foreground" />
      <Label x={92} y={116}>
        {t("allowWrite")}
      </Label>
      <Ring x={218} y={156} w={68} h={20} />
      <Pill x={218} y={156} w={68} primary>
        {t("approve")}
      </Pill>
    </Window>
  );
}

/**
 * Simple drawings of where to press, one per step. Drawn rather than
 * screenshotted: the assistants restyle often, and a drawing shows only the
 * one thing that matters, ringed. The label carries the picture for a
 * screen reader.
 */
export function ConnectAssistantArt({ kind, client }: { kind: ArtKind; client: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.connectedApps.guide" });
  const url = t("artUrl");
  const scene: Record<ArtKind, ReactNode> = {
    openClaude: <OpenClaude />,
    openChatgpt: <OpenChatgpt />,
    addClaude: <AddClaude url={url} />,
    addChatgpt: <AddChatgpt url={url} />,
    allow: <Allow host={UI.uniwork} client={client} />,
  };
  return (
    <svg role="img" aria-label={t(ALT[kind])} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full rounded-lg bg-muted/40">
      {scene[kind]}
    </svg>
  );
}
