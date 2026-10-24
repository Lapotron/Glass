import { getUiLocale, type UiLocale } from './i18n.js';
import type { SiteConfig } from './contracts.js';
import { z } from 'zod';
const label = z.string().trim().max(40).default('');
const collection = z.object({ name: label, singular: label });
const collections = z.object({
  posts: collection.optional(), lab: collection.optional(), life: collection.optional(),
});
export const localizationSchema = z.object({
  enabled: z.boolean().default(true),
  labels: z.object({ 'zh-Hans': collections.optional(), 'zh-Hant': collections.optional() }).default({}),
});
export type Localization = z.infer<typeof localizationSchema>;

export function collectionLabel(site: Pick<SiteConfig,'collections'|'localization'>, kind: 'posts'|'lab'|'life', field: 'name'|'singular' = 'name', locale: UiLocale = getUiLocale()) {
  return (locale === 'en' ? '' : site.localization.labels[locale]?.[kind]?.[field]) || site.collections[kind][field];
}
