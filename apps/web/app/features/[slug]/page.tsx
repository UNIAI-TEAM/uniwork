import { notFound } from "next/navigation";
import { FEATURE_PAGE_KEYS, isFeaturePageKey } from "../../../features/landing/feature-page-catalog";
import { publicPage } from "../../../platform/public-page";
import { seoMetadata } from "../../../platform/seo";
type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;
export function generateStaticParams() { return FEATURE_PAGE_KEYS.map(slug => ({ slug })); }
export async function generateMetadata({ params }: Props) { const { slug } = await params; if (!isFeaturePageKey(slug)) notFound(); return seoMetadata(`/features/${slug}`); }
export default async function Page({ params }: Props) { const { slug } = await params; if (!isFeaturePageKey(slug)) notFound(); return publicPage(`/features/${slug}`); }
