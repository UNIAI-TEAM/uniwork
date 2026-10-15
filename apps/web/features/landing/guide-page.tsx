import type { SupportedLocale } from "@uniwork/core/i18n/types";
import { MarketingLink as Link } from "../../platform/marketing-link";
import { seoCopy } from "../../platform/seo-copy";
import { marketingRoute } from "@uniwork/core/paths";
import { MarketingGuideImage } from "../../platform/marketing-guide-image";
import { guideContent } from "./guide-content";
import { MarketingShell } from "./marketing-shell";
import "./guide-page.css";

/** Read mode: follow the existing typography and navigation, with a single article measure. */
export function GuidePage({ contentKey, locale }: { contentKey: string; locale: SupportedLocale }) {
  const copy = seoCopy(contentKey, locale);
  const guide = guideContent(contentKey, locale);
  const isGuide = contentKey !== "about" && contentKey !== "security";
  return <MarketingShell><article className="public-guide">
    <nav aria-label={locale === "vi" ? "Đường dẫn" : "Breadcrumb"}><Link href="/">UniWork</Link><span aria-hidden>/</span>{isGuide ? <Link href="/learn">{locale === "vi" ? "Hướng dẫn" : "Guides"}</Link> : <span aria-current="page">{copy.title}</span>}</nav>
    <header><h1>{copy.title}</h1><p className="public-guide-introduction">{guide.introduction}</p></header>
    <nav className="public-guide-contents" aria-label={locale === "vi" ? "Trong bài này" : "On this page"}><h2>{locale === "vi" ? "Trong bài này" : "On this page"}</h2><ol>{guide.sections.map((section, index) => <li key={section.title}><a href={`#guide-section-${index + 1}`}>{section.title}</a></li>)}</ol></nav>
    {guide.sections.map((section, index) => <section key={section.title} id={`guide-section-${index + 1}`}><h2>{section.title}</h2>{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}{section.steps && <ol>{section.steps.map(step => <li key={step}>{step}</li>)}</ol>}
      {section.table && <table className="public-guide-table"><caption>{section.table.caption}</caption><thead><tr>{section.table.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{section.table.rows.map(row => <tr key={row[0]}><th scope="row">{row[0]}</th><td>{row[1]}</td><td>{row[2]}</td></tr>)}</tbody></table>}
      {section.example && <aside className="public-guide-example"><h3>{section.example.label}: {section.example.title}</h3><p>{section.example.description}</p></aside>}
      {section.illustration && <MarketingGuideImage locale={locale} {...section.illustration} />}
    </section>)}
    <aside className="public-guide-related"><h2>{locale === "vi" ? "Tiếp tục tìm hiểu" : "Continue exploring"}</h2><ul>{guide.related.map(href => <li key={href}><Link href={href}>{seoCopy(marketingRoute(href)!.key, locale).title}</Link></li>)}</ul></aside>
  </article></MarketingShell>;
}
