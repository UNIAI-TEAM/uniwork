import { notFound } from "next/navigation";
import { FeaturePage } from "../../../features/landing/feature-page";
import { FEATURE_PAGE_KEYS, isFeaturePageKey } from "../../../features/landing/feature-page-catalog";
import { featureMetadata } from "../../../platform/feature-metadata";

type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return FEATURE_PAGE_KEYS.map(slug => ({ slug })); }
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  if (!isFeaturePageKey(slug)) notFound();
  return featureMetadata(slug);
}
export default async function Page({ params }: Props) {
  const { slug } = await params;
  if (!isFeaturePageKey(slug)) notFound();
  return <FeaturePage featureKey={slug} />;
}
