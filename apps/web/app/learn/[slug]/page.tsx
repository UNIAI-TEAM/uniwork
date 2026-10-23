import { notFound } from "next/navigation";
import { MARKETING_GUIDE_KEYS } from "@uniwork/core/paths";
import { publicPage } from "../../../platform/public-page";
import { seoMetadata } from "../../../platform/seo";

type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;
export function generateStaticParams() { return MARKETING_GUIDE_KEYS.map(slug => ({ slug })); }
async function guidePath({ params }: Props) {
  const { slug } = await params;
  if (!MARKETING_GUIDE_KEYS.some(key => key === slug)) notFound();
  return `/learn/${slug}`;
}
export async function generateMetadata(props: Props) { return seoMetadata(await guidePath(props), "en"); }
export default async function Page(props: Props) { return publicPage(await guidePath(props), "en"); }
