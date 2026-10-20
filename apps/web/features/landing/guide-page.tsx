import type { SupportedLocale } from "@uniwork/core/i18n/types";
import { MarketingLink as Link } from "../../platform/marketing-link";
import { seoCopy } from "../../platform/seo-copy";
import { marketingRoute } from "@uniwork/core/paths";
import { MarketingGuideImage } from "../../platform/marketing-guide-image";
import { guideContent, type GuideSection } from "./guide-content";
import type { GuideTable } from "./guide-product-facts";
import { MarketingShell } from "./marketing-shell";
import "./guide-page.css";

/** Read mode: follow the existing typography and navigation, with a single article measure. */
export function GuidePage({ contentKey, locale }: { contentKey: string; locale: SupportedLocale }) {
  const copy = seoCopy(contentKey, locale);
  const guide = guideContent(contentKey, locale);
  const isGuide = !["about", "security", "privacy"].includes(contentKey);
  const sectionId = (section: GuideSection, index: number) => section.id ?? `guide-section-${index + 1}`;
  return <MarketingShell><article className="public-guide">
    <nav aria-label={locale === "vi" ? "Đường dẫn" : "Breadcrumb"}><Link href="/">UniWork</Link><span aria-hidden>/</span>{isGuide ? <Link href="/learn">{locale === "vi" ? "Hướng dẫn" : "Guides"}</Link> : <span aria-current="page">{copy.title}</span>}</nav>
    <header><h1>{copy.title}</h1>{guide.effective && <p className="public-guide-effective">{locale === "vi" ? "Hiệu lực từ ngày" : "Effective"} <time dateTime={guide.effective.dateTime}>{guide.effective.text}</time></p>}<p className="public-guide-introduction">{guide.introduction}</p></header>
    <nav className="public-guide-contents" aria-label={locale === "vi" ? "Trong bài này" : "On this page"}><h2>{locale === "vi" ? "Trong bài này" : "On this page"}</h2><ol>{guide.sections.map((section, index) => <li key={section.title}><a href={`#${sectionId(section, index)}`}>{section.title}</a></li>)}</ol></nav>
    {guide.sections.map((section, index) => <section key={section.title} id={sectionId(section, index)}><h2>{section.title}</h2>{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}{section.steps && <ol>{section.steps.map(step => <li key={step}>{step}</li>)}</ol>}
      {section.table && <GuideTableView table={section.table} />}
      {section.example && <aside className="public-guide-example"><h3>{section.example.label}: {section.example.title}</h3><p>{section.example.description}</p></aside>}
      {section.illustration && <MarketingGuideImage locale={locale} {...section.illustration} />}
    </section>)}
    <aside className="public-guide-related"><h2>{locale === "vi" ? "Tiếp tục tìm hiểu" : "Continue exploring"}</h2><ul>{guide.related.map(href => <li key={href}><Link href={href}>{seoCopy(marketingRoute(href)!.key, locale).title}</Link></li>)}</ul></aside>
  </article></MarketingShell>;
}

/**
 * Below 640px the stylesheet stacks each row into a block, with the column
 * name printed from data-label.
 */
function GuideTableView({ table }: { table: GuideTable }) {
  const [, second, third] = table.columns;
  return <table className={table.layout ? `public-guide-table public-guide-table-${table.layout}` : "public-guide-table"}><caption>{table.caption}</caption>
    <thead><tr>{table.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
    <tbody>{table.rows.map(row => <tr key={row[0]}><th scope="row">{row[0]}</th><td data-label={second}>{row[1]}</td><td data-label={third}>{row[2]}</td></tr>)}</tbody>
  </table>;
}
