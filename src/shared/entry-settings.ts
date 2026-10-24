import type { EntryMeta, SiteConfig } from './contracts.js';

/** Omitted values inherit; false and zero are intentional overrides. */
export function resolveEntrySettings(site: SiteConfig, entry: EntryMeta) {
  const defined = <T extends object>(value: T | undefined) =>
    Object.fromEntries(Object.entries(value || {}).filter(([, v]) => v !== undefined));
  const discussion = site.integrations.comments.enabled && entry.comments;
  const reading = { ...site.reading, ...defined(entry.reading) } as SiteConfig['reading'];
  reading.modifiedDate ??= reading.publishedDate;
  return {
    reading,
    theme: { ...site.theme, ...defined(entry.typography) } as SiteConfig['theme'],
    discussion: {
      article: discussion && entry.discussion?.article !== false,
      blocks: discussion && entry.discussion?.blocks !== false,
      annotations: discussion && entry.discussion?.annotations !== false,
    },
    cover: {
      alt: entry.coverOptions?.alt || entry.title,
      caption: entry.coverOptions?.caption || '',
      visible: entry.coverOptions?.visible !== false,
      ratio: entry.coverOptions?.ratio || 'default',
      focalX: entry.coverOptions?.focalX ?? 50,
      focalY: entry.coverOptions?.focalY ?? 50,
    },
    seo: {
      title: entry.seo?.title || entry.title,
      description: entry.seo?.description || entry.summary || site.description,
      image: entry.seo?.image || entry.cover || site.metadata.socialImage,
      imageAlt: entry.seo?.image
        ? entry.seo.imageAlt || entry.title
        : entry.cover
          ? entry.coverOptions?.alt || entry.title
          : site.metadata.socialImageAlt,
      noindex: entry.seo?.indexing === 'noindex',
    },
  };
}

export const entryMedia = (entry: EntryMeta) =>
  [entry.cover, entry.seo?.image || ''].filter(Boolean);
