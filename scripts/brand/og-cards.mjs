/**
 * The link-preview cards: what Slack, X, LinkedIn, Telegram, iMessage and
 * WhatsApp show when someone pastes a UniWork URL.
 *
 * One layout, four cards. The root card is `app/opengraph-image.png`, which Next
 * serves by file convention to every page that sets no image; the others live
 * in `public/brand/og/` and are named by the routes that use them, through
 * `apps/web/platform/og-image.generated.ts`.
 *
 * The layout: The left column says what the link is in one line a
 * thumbnail can still read; the right column shows the product doing the one
 * thing only it claims — a person and an AI teammate owning the same work —
 * using the product's own objects, colours and icons rather than a
 * screenshot, so it stays legible at the 500px a chat app renders it at.
 *
 * English only. Crawlers send no locale cookie, so every preview is read by
 * someone who has not chosen a language yet; the page they land on defaults to
 * English for the same reason.
 *
 * Colours are the light-mode token values from packages/ui/styles/tokens.css.
 * They are copied, not imported: this card is a raster that must not change
 * when a token is retuned for the app, and tokens.test would not catch it.
 */
import { createRequire } from "node:module";
import path from "node:path";

const C = {
  ink: "#202020",
  muted: "#646464",
  border: "#e4e4e7",
  brand: "#0a52e6",
  brandSubtle: "#e4edff",
  stage: "#eef3ff",
  green: ["#e6f7ee", "#137046"],
  violet: ["#efedfd", "#7612fa"],
  pink: ["#fff1fe", "#b8107f"],
  orange: ["#ffece5", "#a84300"],
  live: ["#fdecec", "#ad1a1a"],
  // People: the solid tints, white initials — the pale tints read as bare text.
  person: { pink: "#cc1694", teal: "#0d6e66", orange: "#c24d00", violet: "#7612fa" },
};

/** Lucide, read from the app's own copy so the card's icons are the product's. */
function lucide(root) {
  const require = createRequire(path.join(root, "apps", "web", "package.json"));
  const icons = require("lucide-react");
  return (name, size, color, stroke = 2) => {
    const el = icons[name].render({}, null);
    const nodes = el.props.iconNode;
    const body = nodes
      .map(([tag, attrs]) => {
        const a = Object.entries(attrs)
          .filter(([k]) => k !== "key")
          .map(([k, v]) => `${k}="${v}"`)
          .join(" ");
        return `<${tag} ${a}/>`;
      })
      .join("");
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  };
}

/**
 * `fonts` maps a weight to TTF bytes. Static instances, not the variable file:
 * the full stop's sidebearing grows with weight through HVAR, and a static
 * instance pins the metrics the card was drawn against.
 */
export function ogCards({ root, fonts, lockup }) {
  const icon = lucide(root);
  const faces = Object.entries(fonts)
    .map(
      ([weight, bytes]) =>
        `@font-face{font-family:Brand;font-weight:${weight};src:url(data:font/ttf;base64,${bytes.toString("base64")}) format("truetype")}`,
    )
    .join("");
  // Display lines: at 72px ExtraBold the full stop's and comma's own
  // sidebearing reads as a space, and the apostrophe floats; both are pulled
  // in optically.
  const line = (text) =>
    text.replace(/([.,])$/, '<span class="stop">$1</span>').replace(/’/g, '<span class="apos">’</span>');
  // Sublines keep their key phrases whole: "AI teammates" split over two lines
  // splits the claim.
  const keep = (text) =>
    text.replace(/\b(AI|No|next|your) (teammates|account|steps|browser)\b/g, "$1&nbsp;$2");

  const tile = ([bg, fg], name, size = 24) =>
    `<span class="tile" style="background:${bg}">${icon(name, size, fg)}</span>`;
  const person = (bg, initials) => `<span class="av" style="background:${bg}">${initials}</span>`;
  // The agent is drawn as the product draws AI: the brand hue and Sparkles.
  // Not a face — PRODUCT.md rules out mascot-like agent avatars.
  const agent = () => `<span class="av agent">${icon("Sparkles", 24, "#fff")}</span>`;
  const pill = ([bg, fg], text, dot = false) =>
    `<span class="pill" style="background:${bg};color:${fg}">${dot ? `<i style="background:${fg}"></i>` : ""}${text}</span>`;
  const team = `${person(C.person.teal, "JK")}${person(C.person.orange, "SL")}${person(C.person.pink, "MA")}${agent()}`;
  const teammate = `<em>AI teammate</em>`;

  // The hero: the one object the link is about, at a size whose owners row —
  // a person and UNI on the same record, the product's one claim — still
  // reads in a 500px unfurl. No kind label: the tinted tile says what it is.
  const hero = ({ tone, glyph, status, title, prose = "", owners, who }) => `
      <article class="card hero">
        <header>${tile(tone, glyph, 26)}${status}</header>
        <h3>${title}</h3>${prose && `
        <p class="prose">${prose}</p>`}
        <footer><span class="owners">${owners}</span><span class="who">${who}</span></footer>
      </article>`;
  // Supporting objects recede: one row, smaller, lighter shadow.
  const row = ({ tone, glyph, title, status = "" }) => `
      <article class="card row">${tile(tone, glyph, 20)}<h4>${title}</h4>${status}</article>`;

  const objects = {
    task: () =>
      hero({
        tone: C.green, glyph: "CircleCheck", status: pill([C.brandSubtle, C.brand], "In progress"),
        title: "Finalize the launch plan",
        owners: `${person(C.person.pink, "MA")}${agent()}`,
        who: `<b>Maya</b>&nbsp;&amp;&nbsp;<b>UNI</b>${teammate}`,
      }),
    meeting: () =>
      hero({
        // An invitation, not "Live": the meeting behind the link may be days away.
        tone: C.violet, glyph: "Video", status: pill([C.brandSubtle, C.brand], "Invitation"),
        title: "Weekly product sync",
        owners: team,
        who: `<b>UNI</b>&nbsp;takes notes`,
      }),
    members: () =>
      hero({
        tone: C.pink, glyph: "Users", status: pill([C.brandSubtle, C.brand], "Invitation"),
        title: "Product team",
        owners: team,
        who: `<b>3 people</b>&nbsp;&amp;&nbsp;<b>UNI</b>`,
      }),
    doc: () =>
      hero({
        tone: C.orange, glyph: "FileText", status: pill([C.brandSubtle, C.brand], "Shared"),
        title: "Launch plan",
        prose: "Goals, owners and dates, agreed.",
        owners: `${person(C.person.pink, "MA")}${agent()}`,
        who: `<b>Maya</b>&nbsp;&amp;&nbsp;<b>UNI</b>${teammate}`,
      }),
    liveMeeting: () =>
      row({ tone: C.violet, glyph: "Video", title: "Weekly product sync", status: pill(C.live, "Live", true) }),
    taskRow: () =>
      row({ tone: C.green, glyph: "CircleCheck", title: "Finalize the launch plan" }),
    // Ask UNI as the product draws it: a prompt field, not a labelled card.
    ask: () => `
      <div class="ask">${icon("Sparkles", 24, C.brand)}<span>What is blocking the launch?</span>
        <b>${icon("ArrowRight", 20, "#fff", 2.25)}</b></div>`,
  };

  const page = ({ lineA, lineB, sub, stack }) => `<!doctype html><html><head><style>
    ${faces}
    *{box-sizing:border-box;margin:0}
    html,body{width:1200px;height:630px;overflow:hidden;background:#fff}
    body{font-family:Brand;color:${C.ink};-webkit-font-smoothing:antialiased;font-kerning:normal}
    .card-root{position:relative;width:1200px;height:630px}
    .copy{position:absolute;left:72px;top:64px;bottom:64px;width:600px;display:flex;flex-direction:column}
    .copy .lockup{height:40px;width:${(40 * 485.23) / 92}px;display:block;flex:none}
    .copy .lockup svg{width:100%;height:100%;display:block}
    .copy .text{margin-top:auto;margin-bottom:auto;padding-bottom:8px}
    h1{font-size:72px;line-height:1.02;font-weight:800;letter-spacing:-.035em;text-wrap:balance}
    h1 .b{display:block;color:${C.brand}}
    .stop{margin-left:-.07em}
    .apos{margin:0 -.03em 0 -.05em}
    .sub{margin-top:28px;font-size:27px;line-height:1.4;font-weight:500;color:${C.muted};max-width:540px;
      letter-spacing:-.005em;text-wrap:pretty}
    .stage{position:absolute;left:712px;top:40px;width:560px;height:660px;border-radius:32px;
      background:${C.stage};border:1px solid #d9e4fb}
    /* Centred on the frame, like the copy column, so the two share one axis. */
    .stack{position:absolute;left:744px;top:0;bottom:0;width:424px;display:flex;flex-direction:column;
      justify-content:center;gap:16px}
    .card{background:#fff;border:1px solid ${C.border};border-radius:22px}
    .hero{padding:26px 28px 28px;box-shadow:0 1px 2px rgba(16,24,40,.05),0 22px 44px -18px rgba(10,82,230,.34)}
    .hero header{display:flex;align-items:center}
    .tile{width:48px;height:48px;border-radius:13px;display:grid;place-items:center;flex:none}
    .pill{margin-left:auto;display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 15px;border-radius:999px;
      font-size:17px;font-weight:700;white-space:nowrap}
    .pill i{width:9px;height:9px;border-radius:50%}
    .hero h3{margin-top:20px;font-size:32px;line-height:1.15;font-weight:800;letter-spacing:-.025em}
    .prose{margin-top:8px;font-size:21px;line-height:1.4;color:${C.muted};font-weight:500}
    .hero footer{margin-top:22px;display:flex;align-items:center;gap:14px}
    .owners{display:flex;flex:none}
    .av{width:50px;height:50px;border-radius:50%;display:grid;place-items:center;font-size:16px;font-weight:700;color:#fff;
      border:3px solid #fff;letter-spacing:.02em}
    .owners .av+.av{margin-left:-10px}
    .av.agent{background:${C.brand}}
    .who{font-size:22px;color:${C.muted};font-weight:500;display:flex;align-items:center;white-space:nowrap}
    .who b{color:${C.ink};font-weight:700}
    .who em{font-style:normal;margin-left:10px;font-size:17px;font-weight:700;color:${C.brand};background:${C.brandSubtle};
      padding:5px 11px;border-radius:999px}
    .row{display:flex;align-items:center;gap:14px;padding:14px 18px 14px 14px;margin:0 12px;
      box-shadow:0 1px 2px rgba(16,24,40,.05),0 10px 24px -16px rgba(10,82,230,.22)}
    .row .tile{width:40px;height:40px;border-radius:11px}
    .row h4{font-size:21px;font-weight:700;letter-spacing:-.015em;white-space:nowrap}
    .row .pill{height:30px;font-size:15px;padding:0 12px}
    .ask{margin:0 12px;height:62px;display:flex;align-items:center;gap:12px;padding:0 10px 0 20px;background:#fff;
      border:1.5px solid #c9d8fb;border-radius:999px;font-size:20px;font-weight:600;color:${C.ink};
      box-shadow:0 10px 24px -16px rgba(10,82,230,.22)}
    .ask span{flex:1}
    .ask b{width:42px;height:42px;border-radius:50%;background:${C.brand};display:grid;place-items:center}
  </style></head><body><div class="card-root">
    <div class="copy">
      <div class="lockup">${lockup}</div>
      <div class="text">
        <h1>${line(lineA)}<span class="b">${line(lineB)}</span></h1>
        <p class="sub">${keep(sub)}</p>
      </div>
    </div>
    <div class="stage"></div>
    <div class="stack">${stack.map((k) => objects[k]()).join("")}</div>
  </div></body></html>`;

  return [
    {
      key: "root",
      out: ["apps", "web", "app", "opengraph-image"],
      alt:
        "UniWork: Your team. One workspace. A task owned together by Maya and UNI, " +
        "an AI teammate, above a live meeting and an Ask UNI prompt.",
      html: page({
        lineA: "Your team.",
        lineB: "One workspace.",
        sub: "Tasks, meetings, conversations and AI teammates in one Business OS.",
        stack: ["task", "liveMeeting", "ask"],
      }),
    },
    {
      key: "meetingInvite",
      out: ["apps", "web", "public", "brand", "og", "meeting-invite"],
      alt: "UniWork meeting invitation: join the meeting from your browser, with UNI taking the notes.",
      html: page({
        lineA: "You’re invited",
        lineB: "to a meeting.",
        sub: "Join from your browser. Notes and next steps stay with the work.",
        stack: ["meeting", "taskRow", "ask"],
      }),
    },
    {
      key: "workspaceInvite",
      out: ["apps", "web", "public", "brand", "og", "workspace-invite"],
      alt: "UniWork workspace invitation: join a team of people and UNI, an AI teammate.",
      html: page({
        lineA: "You’re invited",
        lineB: "to join the team.",
        sub: "Accept the invitation to work with your teammates and AI teammates.",
        stack: ["members", "taskRow", "ask"],
      }),
    },
    {
      key: "sharedDocument",
      out: ["apps", "web", "public", "brand", "og", "shared-document"],
      alt: "A document shared from UniWork, written by Maya and UNI, open to read in the browser.",
      html: page({
        lineA: "A document,",
        lineB: "shared with you.",
        sub: "Open it in your browser to read. No account needed.",
        stack: ["doc", "taskRow", "ask"],
      }),
    },
  ];
}
