"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ClaudeMark, OpenAIMark } from "../../common/provider-icons";

export type ArtKind = "openClaude" | "openChatgpt" | "addClaude" | "addChatgpt" | "allow";

const ALT: Record<ArtKind, string> = {
  openClaude: "artOpenClaude",
  openChatgpt: "artOpenChatgpt",
  addClaude: "artAddClaude",
  addChatgpt: "artAddChatgpt",
  allow: "artAllow",
};

/**
 * ChatGPT's own labels, copied from chatgpt.com/plugins on 2026-10-16. Not
 * translated: ChatGPT showed them in English for a Vietnamese account. Claude
 * follows its user's language, so its labels live in the locale files
 * (guide.uiClaude*). Both drift with each redesign: re-check the live pages
 * and change the steps' text and these drawings together.
 */
const GPT = {
  host: "chatgpt.com",
  plugins: "Plugins",
  add: "Add ▾",
  create: "Create plugin",
  upload: "Upload plugin archive",
  addMcp: "Add custom MCP server",
  name: "Name",
  description: "Description (optional)",
  connection: "Connection",
  serverUrl: "Server URL",
  tunnel: "Tunnel",
  auth: "Authentication",
  oauth: "OAuth",
  understand: "I understand and want to continue",
  cancel: "Cancel",
  createPlugin: "Create as a plugin",
} as const;

const CLAUDE_HOST = "claude.ai";
const UNIWORK = "UniWork";
const W = 360;
/** The site marks in the address bar, where a browser shows the favicon. */
const CLAUDE_FAVICON = <ClaudeMark x={116} y={13} width={10} height={10} />;
const GPT_FAVICON = <OpenAIMark x={116} y={13} width={10} height={10} className="text-foreground" />;

/** A browser window of height `h`: the frame every scene is drawn in, the site's mark as its favicon. */
function Window({ host, h, mark, children }: { host: string; h: number; mark?: ReactNode; children: ReactNode }) {
  return (
    <>
      <rect x={6} y={6} width={W - 12} height={h - 12} rx={10} className="fill-background stroke-border" />
      <path d={`M6 30 H${W - 6}`} className="stroke-border" />
      {[18, 30, 42].map((cx) => (
        <circle key={cx} cx={cx} cy={18} r={3.5} className="fill-muted-foreground/40" />
      ))}
      <rect x={110} y={11} width={140} height={14} rx={7} className="fill-muted" />
      {mark}
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

function Label({
  x,
  y,
  children,
  strong = false,
  size = 10,
  muted = false,
}: {
  x: number;
  y: number;
  children: ReactNode;
  strong?: boolean;
  size?: number;
  muted?: boolean;
}) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={strong ? 600 : 400} className={muted ? "fill-muted-foreground" : "fill-foreground"}>
      {children}
    </text>
  );
}

function Field({ x, y, w, label, value, ring = false }: { x: number; y: number; w: number; label: string; value?: string; ring?: boolean }) {
  return (
    <>
      <Label x={x} y={y} size={9} muted>
        {label}
      </Label>
      {ring ? <Ring x={x} y={y + 5} w={w} h={18} /> : null}
      <rect x={x} y={y + 5} width={w} height={18} rx={4} className="fill-background stroke-border" />
      {value ? (
        <Label x={x + 6} y={y + 17.5} size={9.5}>
          {value}
        </Label>
      ) : null}
    </>
  );
}

function Pill({ x, y, w, children, primary = false }: { x: number; y: number; w: number; children: ReactNode; primary?: boolean }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={20} rx={10} className={primary ? "fill-primary" : "fill-background stroke-border"} />
      <text x={x + w / 2} y={y + 13.5} textAnchor="middle" fontSize={9.5} fontWeight={600} className={primary ? "fill-primary-foreground" : "fill-foreground"}>
        {children}
      </text>
    </>
  );
}

/** A dropdown under a button, its last item ringed. */
function Menu({ x, y, w, items }: { x: number; y: number; w: number; items: string[] }) {
  const last = items.length - 1;
  return (
    <>
      <rect x={x} y={y} width={w} height={items.length * 20 + 8} rx={8} className="fill-background stroke-border" />
      <Ring x={x + 5} y={y + 4 + last * 20} w={w - 10} h={18} />
      {items.map((item, i) => (
        <Label key={item} x={x + 12} y={y + 17 + i * 20} size={9.5}>
          {item}
        </Label>
      ))}
    </>
  );
}

/** Claude's sidebar and Customize page, the Connectors tab chosen. */
function ClaudeCustomize({ ringNav }: { ringNav: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.connectedApps.guide" });
  return (
    <>
      <path d="M100 30 V194" className="stroke-border" />
      <ClaudeMark x={16} y={39} width={13} height={13} />
      <Label x={33} y={49.5} size={11} strong>
        {"Claude"}
      </Label>
      <Bar x={18} y={58} w={44} />
      {ringNav ? <Ring x={14} y={70} w={78} h={18} /> : null}
      <rect x={14} y={70} width={78} height={18} rx={5} className="fill-muted" />
      <Label x={20} y={82.5} strong>
        {t("uiClaudeCustomize")}
      </Label>
      <Bar x={18} y={100} w={50} />
      <Label x={116} y={52} size={12} strong>
        {t("uiClaudeCustomize")}
      </Label>
      <Label x={116} y={77} size={9} muted>
        {"Skills"}
      </Label>
      {ringNav ? <Ring x={146} y={65} w={84} h={17} /> : null}
      <rect x={146} y={65} width={84} height={17} rx={5} className="fill-muted" />
      <text x={188} y={77} textAnchor="middle" fontSize={9} fontWeight={600} className="fill-foreground">
        {t("uiClaudeConnectors")}
      </text>
      <Label x={238} y={77} size={9} muted>
        {t("uiClaudePlugins")}
      </Label>
      {[96, 134].map((y) => (
        <g key={y}>
          <rect x={116} y={y} width={106} height={30} rx={5} className="fill-muted/50" />
          <rect x={230} y={y} width={106} height={30} rx={5} className="fill-muted/50" />
          <Bar x={124} y={y + 12} w={60} />
          <Bar x={238} y={y + 12} w={60} />
        </g>
      ))}
    </>
  );
}

function OpenClaude() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.connectedApps.guide" });
  return (
    <Window host={CLAUDE_HOST} h={200} mark={CLAUDE_FAVICON}>
      <ClaudeCustomize ringNav />
      <Pill x={W - 78} y={40} w={60}>
        {t("uiClaudeAdd")}
      </Pill>
    </Window>
  );
}

/** Claude's "Add custom connector" box: name, server URL, Continue. */
function AddClaude({ url }: { url: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.connectedApps.guide" });
  return (
    <Window host={CLAUDE_HOST} h={230} mark={CLAUDE_FAVICON}>
      <rect x={7} y={31} width={W - 14} height={192} className="fill-muted/60" />
      <rect x={56} y={40} width={248} height={180} rx={10} className="fill-background stroke-border" />
      <Label x={70} y={60} size={11} strong>
        {t("uiClaudeAddCustom")}
      </Label>
      <Bar x={70} y={70} w={200} />
      <rect x={70} y={86} width={220} height={18} rx={5} className="fill-background stroke-border" />
      <Label x={76} y={98.5} size={9.5}>
        {UNIWORK}
      </Label>
      <Bar x={70} y={110} w={110} />
      <Ring x={70} y={124} w={220} h={18} />
      <rect x={70} y={124} width={220} height={18} rx={5} className="fill-background stroke-border" />
      <Label x={76} y={136.5} size={9.5}>
        {url}
      </Label>
      <Bar x={70} y={148} w={180} />
      <Bar x={70} y={164} w={210} />
      <Bar x={70} y={174} w={150} />
      <Pill x={176} y={190} w={48}>
        {t("uiClaudeCancel")}
      </Pill>
      <Pill x={230} y={190} w={60} primary>
        {t("uiClaudeContinue")}
      </Pill>
    </Window>
  );
}

function OpenChatgpt() {
  return (
    <Window host={GPT.host} h={200} mark={GPT_FAVICON}>
      <path d="M100 30 V194" className="stroke-border" />
      <OpenAIMark x={16} y={39} width={13} height={13} className="text-foreground" />
      <Label x={33} y={49.5} size={11} strong>
        {"ChatGPT"}
      </Label>
      <Bar x={18} y={58} w={44} />
      <rect x={14} y={70} width={78} height={18} rx={5} className="fill-muted" />
      <Label x={20} y={82.5} strong>
        {GPT.plugins}
      </Label>
      <Bar x={18} y={100} w={50} />
      <Label x={116} y={58} size={12} strong>
        {GPT.plugins}
      </Label>
      <rect x={116} y={70} width={120} height={16} rx={8} className="fill-muted/60 stroke-border" />
      {[100, 124, 148].map((y) => (
        <g key={y}>
          <rect x={116} y={y} width={120} height={18} rx={4} className="fill-muted/50" />
          <Bar x={124} y={y + 6} w={70} />
        </g>
      ))}
      <Ring x={W - 64} y={38} w={46} h={20} />
      <Pill x={W - 64} y={38} w={46}>
        {GPT.add}
      </Pill>
      <Menu x={W - 166} y={64} w={148} items={[GPT.create, GPT.upload, GPT.addMcp]} />
    </Window>
  );
}

function AddChatgpt({ url }: { url: string }) {
  return (
    <Window host={GPT.host} h={280} mark={GPT_FAVICON}>
      <rect x={7} y={31} width={W - 14} height={242} className="fill-muted/60" />
      <rect x={60} y={38} width={240} height={234} rx={10} className="fill-background stroke-border" />
      <Label x={72} y={56} strong>
        {GPT.addMcp}
      </Label>
      <Field x={72} y={74} w={216} label={GPT.name} value={UNIWORK} />
      <Field x={72} y={112} w={216} label={GPT.description} />
      <Field x={72} y={150} w={216} label={GPT.connection} value={url} ring />
      <rect x={196} y={139} width={92} height={14} rx={7} className="fill-muted" />
      <rect x={197} y={140} width={50} height={12} rx={6} className="fill-background" />
      <text x={222} y={149} textAnchor="middle" fontSize={7.5} fontWeight={600} className="fill-foreground">
        {GPT.serverUrl}
      </text>
      <text x={267} y={149} textAnchor="middle" fontSize={7.5} className="fill-muted-foreground">
        {GPT.tunnel}
      </text>
      <Field x={72} y={188} w={100} label={GPT.auth} value={GPT.oauth} />
      <Ring x={72} y={218} w={216} h={16} />
      <rect x={76} y={220} width={11} height={11} rx={3} className="fill-primary" />
      <path d="M78.5 225.5 l2.5 2.5 l4.5 -5" fill="none" strokeWidth={1.6} className="stroke-primary-foreground" />
      <Label x={93} y={229.5} size={9.5}>
        {GPT.understand}
      </Label>
      <Pill x={130} y={244} w={52}>
        {GPT.cancel}
      </Pill>
      <Pill x={188} y={244} w={100} primary>
        {GPT.createPlugin}
      </Pill>
    </Window>
  );
}

/** UniWork's own consent page, so its labels come from the same keys the page uses. */
function Allow({ client }: { client: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.connect" });
  return (
    <Window host={UNIWORK} h={200}>
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
 * Simple drawings of where to press, one per step, traced from the live
 * pages. Drawn rather than screenshotted: the assistants restyle often, and a
 * drawing shows only the controls that matter, ringed. The label carries the
 * picture for a screen reader.
 */
export function ConnectAssistantArt({ kind, client }: { kind: ArtKind; client: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.connectedApps.guide" });
  const h = kind === "addChatgpt" ? 280 : kind === "addClaude" ? 230 : 200;
  let scene: ReactNode;
  if (kind === "openClaude") scene = <OpenClaude />;
  else if (kind === "addClaude") scene = <AddClaude url={t("artUrl")} />;
  else if (kind === "openChatgpt") scene = <OpenChatgpt />;
  else if (kind === "addChatgpt") scene = <AddChatgpt url={t("artUrl")} />;
  else scene = <Allow client={client} />;
  return (
    <svg role="img" aria-label={t(ALT[kind])} viewBox={`0 0 ${W} ${h}`} className="block h-auto w-full rounded-lg bg-muted/40">
      {scene}
    </svg>
  );
}
