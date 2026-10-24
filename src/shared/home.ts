import { collectionIndexRoute } from './collections.js';
import { chronologicalEntries, routeFor, type HomeSlide, type Repository } from './contracts.js';

export function recentHomeEntries(model: Pick<Repository, 'site' | 'entries'>) {
  const pinned = new Set(model.site.home.pinned);
  return chronologicalEntries(model.entries)
    .filter((entry) => !pinned.has(entry.id) && model.site.home.recent.sources.includes(entry.kind))
    .slice(0, model.site.home.recent.limit);
}

export function pinnedHomeEntries(model: Pick<Repository, 'site' | 'entries'>) {
  const published = new Map(
    model.entries.filter((entry) => entry.status === 'published').map((entry) => [entry.id, entry]),
  );
  return model.site.home.pinned.flatMap((id) => {
    const entry = published.get(id);
    return entry ? [entry] : [];
  });
}

export function defaultSlides(model: Pick<Repository, 'entries' | 'library'>): HomeSlide[] {
  const entries = model.entries
    .filter((e) => e.status === 'published' && e.cover)
    .sort(
      (a, b) =>
        Number(b.featured) - Number(a.featured) || b.publishedAt.localeCompare(a.publishedAt),
    );
  const sources = [
    ...entries.slice(0, 3).map((e) => ({ source: 'entry' as const, reference: e.id })),
    ...model.library.photos.slice(0, 3).map((p) => ({ source: 'photo' as const, reference: p.id })),
  ];
  return sources.map((s, i) => ({
    ...s,
    id: `chapter-${i + 1}`,
    enabled: true,
    image: '',
    title: '',
    caption: '',
    alt: '',
    href: '',
    focalX: 50,
    focalY: 50,
  }));
}
export function resolveSlides(model: Pick<Repository, 'site' | 'entries' | 'library'>) {
  return (model.site.home.slides ?? defaultSlides(model)).flatMap((slide) => {
    if (!slide.enabled) return [];
    const entry = model.entries.find((e) => e.id === slide.reference && e.status === 'published');
    const photo = model.library.photos.find((p) => p.id === slide.reference);
    if ((slide.source === 'entry' && !entry) || (slide.source === 'photo' && !photo)) return [];
    return [
      {
        ...slide,
        image:
          slide.image ||
          (slide.source === 'entry' ? entry?.cover : slide.source === 'photo' ? photo?.src : '') ||
          '',
        title:
          slide.title ||
          (slide.source === 'entry'
            ? entry?.title
            : slide.source === 'photo'
              ? photo?.album
              : '') ||
          '',
        caption:
          slide.caption ||
          (slide.source === 'entry'
            ? entry?.summary
            : slide.source === 'photo'
              ? photo?.caption
              : '') ||
          '',
        alt: slide.alt || photo?.alt || slide.title || entry?.title || '',
        href:
          slide.href ||
          (slide.source === 'entry' && entry
            ? routeFor(entry, model.site.collections)
            : slide.source === 'photo'
              ? collectionIndexRoute('life', model.site.collections)
              : ''),
      },
    ];
  });
}
