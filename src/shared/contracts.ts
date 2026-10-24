import { localizationSchema } from './localization.js';
import { acaSettingsSchema } from './aca.js';
import { z } from 'zod';
import { appearanceRanges, contrastFloorRange, textScaleRange } from './appearance-ranges.js';
import { discussionLanguages, discussionThemes } from './discussions.js';
import { contrastPreset } from './contrast.js';
import { shortLinkPattern } from './shortlinks.js';
import { mediaMetadataSchema } from './media-metadata.js';
import { mediaProtectionSchema } from './media-protection.js';
import { mathSettingsSchema } from './math-authoring.js';
import { entryRouteAliasSchema } from './entry-routes.js';
import { collectionsSchema, collectionIndexRoute, defaultCollections } from './collections.js';
import { headingSlug } from './utils.js';
export { routeFor } from './collections.js';
import {
  brandingSchema,
  metadataSchema,
  languageSchema,
  navigationToolsSchema,
  footerSchema,
  feedsSchema,
} from './site-settings.js';

export const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u, 'Use words separated by hyphens');
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Use a real YYYY-MM-DD date',
  );
const link = z
  .string()
  .refine((v) => /^(https:\/\/|mailto:|\/(?!\/))/.test(v), 'Use an HTTPS, mailto, or local link');
export type EntryMeta = z.infer<typeof entrySchema>;
export type ContentKind = 'posts' | 'lab';
export type ContentEntry = EntryMeta & {
  kind: ContentKind;
  body: string;
  revision: string;
  file: string;
};
export type PublicEntry = Omit<ContentEntry, 'file'>;
export type EntryRevision = {
  revision: string;
  savedAt: string;
  title: string;
  reason: 'edit' | 'restore' | 'schedule' | 'batch';
  words: number;
  status: EntryMeta['status'];
};
const foregroundSchema = z.object({
  heading: z
    .string()
    .regex(/^#[a-f\d]{6}$/i)
    .optional(),
  body: z
    .string()
    .regex(/^#[a-f\d]{6}$/i)
    .optional(),
  secondary: z
    .string()
    .regex(/^#[a-f\d]{6}$/i)
    .optional(),
  metadata: z
    .string()
    .regex(/^#[a-f\d]{6}$/i)
    .optional(),
  link: z
    .string()
    .regex(/^#[a-f\d]{6}$/i)
    .optional(),
  placeholder: z
    .string()
    .regex(/^#[a-f\d]{6}$/i)
    .optional(),
});
export const contrastSchema = z.object({
  preset: z.enum(['balanced', 'high']).default('balanced'),
  readingTarget: z.union([z.literal(4.5), z.literal(7)]).default(7),
  interfaceTarget: z.union([z.literal(4.5), z.literal(7)]).default(4.5),
  automatic: z.boolean().default(true),
  glassFloor: z.number().min(contrastFloorRange[0]).max(contrastFloorRange[1]).default(0.58),
  readingFloor: z.number().min(contrastFloorRange[0]).max(contrastFloorRange[1]).default(0.68),
  colors: z
    .object({ light: foregroundSchema.default({}), dark: foregroundSchema.default({}) })
    .default({ light: {}, dark: {} }),
});
const appearanceNumber = (name: keyof typeof appearanceRanges) =>
  z.number().min(appearanceRanges[name][0]).max(appearanceRanges[name][1]);
export const themeSchema = z.object({
  contrast: contrastSchema.default(contrastPreset()),
  appearance: z.enum(['system', 'light', 'dark']).default('system'),
  accent: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default('#3868e8'),
  background: z.enum(['sky', 'sand', 'mist']).default('sky'),
  backgroundImage: z
    .string()
    .refine(
      (value) =>
        value === '' ||
        (/^\/media\/[^?#]+\.(?:png|jpe?g|webp|avif|svg)$/i.test(value) &&
          !/[<>"'(){}\\\r\n]/.test(value)),
      'Choose an image from the local media library',
    )
    .default(''),
  fontScale: appearanceNumber('fontScale').default(1),
  textScale: z.number().min(textScaleRange[0]).max(textScaleRange[1]).default(1),
  focusMode: z.boolean().default(false),
  contentWidth: appearanceNumber('contentWidth').int().default(1120),
  glass: appearanceNumber('glass').default(0.7),
  reduceTransparency: z.boolean().default(false),
  fontFamily: z.enum(['system', 'serif', 'humanist']).default('system'),
  articleWidth: appearanceNumber('articleWidth').int().default(864),
  lineHeight: appearanceNumber('lineHeight').default(1.85),
  paragraphSpace: appearanceNumber('paragraphSpace').default(1.35),
  cornerRadius: appearanceNumber('cornerRadius').int().default(24),
  glassBlur: appearanceNumber('glassBlur').default(11),
  glassOpacity: appearanceNumber('glassOpacity').default(0.42),
  glassSaturation: appearanceNumber('glassSaturation').int().default(150),
  readingOpacity: appearanceNumber('readingOpacity').default(0.86),
  wallpaperBlur: appearanceNumber('wallpaperBlur').default(0),
  wallpaperDim: appearanceNumber('wallpaperDim').default(0.35),
  wallpaperWash: z.enum(['auto', 'light', 'dark']).default('auto'),
  wallpaperPosition: z.enum(['center', 'top', 'bottom']).default('center'),
  ambientIntensity: appearanceNumber('ambientIntensity').default(0.7),
  reduceMotion: z.boolean().default(false),
});
const readingSchema = z.object({
  outline: z.boolean().default(true),
  progress: z.boolean().default(true),
  readingTime: z.boolean().default(true),
  publishedDate: z.boolean().default(true),
  modifiedDate: z.boolean().optional(),
  articleFooter: z.boolean().default(true),
  author: z.boolean().default(true),
  relatedCount: z.number().int().min(0).max(4).default(2),
  codeLineNumbers: z.boolean().default(false),
});
export const entrySchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/, 'Use a stable alphanumeric identity'),
    slug: slugSchema,
    title: z.string().min(1).max(160),
    summary: z.string().max(500).default(''),
    publishedAt: date,
    updatedAt: date.optional(),
    status: z.enum(['draft', 'scheduled', 'published']).default('draft'),
    publishAt: z.union([z.iso.datetime(), z.literal('')]).default(''),
    tags: z.array(z.string().min(1).max(40)).max(12).default([]),
    lang: z.enum(['en', 'zh']).default('en'),
    cover: z.string().default(''),
    math: mathSettingsSchema.optional(),
    coverOptions: z
      .object({
        alt: z.string().max(500).optional(),
        caption: z.string().max(1000).optional(),
        visible: z.boolean().optional(),
        ratio: z.enum(['default', 'wide', 'landscape', 'original']).optional(),
        focalX: z.number().min(0).max(100).optional(),
        focalY: z.number().min(0).max(100).optional(),
      })
      .optional(),
    reading: z
      .object({
        outline: readingSchema.shape.outline.removeDefault().optional(),
        progress: readingSchema.shape.progress.removeDefault().optional(),
        readingTime: readingSchema.shape.readingTime.removeDefault().optional(),
        publishedDate: readingSchema.shape.publishedDate.removeDefault().optional(),
        author: readingSchema.shape.author.removeDefault().optional(),
        modifiedDate: z.boolean().optional(),
        articleFooter: readingSchema.shape.articleFooter.removeDefault().optional(),
        relatedCount: readingSchema.shape.relatedCount.removeDefault().optional(),
        codeLineNumbers: readingSchema.shape.codeLineNumbers.removeDefault().optional(),
      })
      .optional(),
    typography: z
      .object({
        fontFamily: themeSchema.shape.fontFamily.removeDefault().optional(),
        articleWidth: themeSchema.shape.articleWidth.removeDefault().optional(),
        lineHeight: themeSchema.shape.lineHeight.removeDefault().optional(),
        paragraphSpace: themeSchema.shape.paragraphSpace.removeDefault().optional(),
      })
      .optional(),
    discussion: z
      .object({
        articleTerm: z.string().max(500).optional(),
        article: z.boolean().optional(),
        blocks: z.boolean().optional(),
        annotations: z.boolean().optional(),
      })
      .optional(),
    seo: z
      .object({
        title: z.string().max(160).optional(),
        description: z.string().max(500).optional(),
        image: z
          .string()
          .max(2000)
          .refine((value) => {
            if (!value) return true;
            if (/^\/media\/[^\\<>"\r\n]+$/.test(value)) return true;
            try {
              const url = new URL(value);
              return url.protocol === 'https:' && !url.username && !url.password;
            } catch {
              return false;
            }
          }, 'Choose local media or an HTTPS image.')
          .optional(),
        imageAlt: z.string().max(500).optional(),
        indexing: z.enum(['inherit', 'noindex']).optional(),
      })
      .optional(),
    featured: z.boolean().default(false),
    demo: z.boolean().default(false),
    comments: z.boolean().default(true),
    shortCode: z
      .string()
      .regex(/^$|^[a-z0-9][a-z0-9_-]{2,31}$/)
      .default(''),
    shortAliases: z.array(z.string().regex(shortLinkPattern)).max(10).default([]),
    routeAliases: z.array(entryRouteAliasSchema).max(80).default([]),
  })
  .superRefine((value, context) => {
    if (value.status === 'scheduled' && !value.publishAt)
      context.addIssue({
        code: 'custom',
        path: ['publishAt'],
        message: 'Choose a publication time for the scheduled entry.',
      });
  });
const publishingSchema = z.object({
  scheduleEnabled: z.boolean().default(false),
  scheduleAction: z.enum(['build', 'publish']).default('build'),
});
const analyticsSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(['manual', 'managed']).default('manual'),
    token: z
      .string()
      .regex(/^$|^[a-f0-9]{32}$/i)
      .default(''),
    respectPrivacy: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (value.enabled && value.mode === 'manual' && !value.token)
      context.addIssue({
        code: 'custom',
        path: ['token'],
        message: 'Enter the public Cloudflare Web Analytics token.',
      });
  });
export const googleAnalyticsSchema = z
  .object({
    enabled: z.boolean().default(false),
    measurementId: z
      .string()
      .trim()
      .toUpperCase()
      .max(32)
      .regex(/^$|^G-[A-Z0-9]{4,30}$/, 'Use a GA4 measurement ID such as G-ABC1234567.')
      .default(''),
    respectPrivacy: z.boolean().default(true),
    debugMode: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (value.enabled && !value.measurementId)
      context.addIssue({
        code: 'custom',
        path: ['measurementId'],
        message: 'Enter your Google Analytics 4 measurement ID before enabling analytics.',
      });
  });
export const commentsSchema = z
  .object({
    enabled: z.boolean().default(false),
    repo: z
      .string()
      .regex(/^$|^[\w.-]+\/[\w.-]+$/)
      .default(''),
    repoId: z
      .string()
      .max(100)
      .regex(/^[\w=-]*$/)
      .default(''),
    category: z.string().max(100).default('General'),
    categoryId: z
      .string()
      .max(100)
      .regex(/^[\w=-]*$/)
      .default(''),
    reactions: z.boolean().default(true),
    onDemand: z.boolean().default(true),
    language: z.enum(['auto', ...discussionLanguages]).default('auto'),
    inputPosition: z.enum(['top', 'bottom']).default('top'),
    showMetadata: z.boolean().default(true),
    theme: z.enum(['site', ...discussionThemes]).default('site'),
    title: z.string().trim().min(1).max(100).default('A conversation, continued.'),
    description: z.string().max(300).default('Questions, notes, and a different point of view.'),
  })
  .superRefine((value, context) => {
    if (value.enabled && (!value.repo || !value.repoId || !value.categoryId))
      context.addIssue({
        code: 'custom',
        path: ['repo'],
        message: 'Enter the repository, repository ID, and category ID from giscus.app.',
      });
  });
const newsletterSchema = z
  .object({
    enabled: z.boolean().default(false),
    url: z
      .string()
      .max(2048)
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return url.protocol === 'https:' && !url.username && !url.password;
        } catch {
          return false;
        }
      }, 'Use the HTTPS subscription page from your newsletter provider.')
      .default(''),
    title: z.string().min(1).max(100).default('A note, now and then.'),
    description: z
      .string()
      .max(300)
      .default('New writing and small discoveries, delivered at a quieter pace.'),
    buttonLabel: z.string().min(1).max(40).default('Subscribe'),
  })
  .superRefine((value, context) => {
    if (value.enabled && !value.url)
      context.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'Enter your newsletter subscription URL.',
      });
  });
const integrationsSchema = z.object({
  aca: acaSettingsSchema.default(() => acaSettingsSchema.parse({})),
  analytics: analyticsSchema.default(() => analyticsSchema.parse({})),
  googleAnalytics: googleAnalyticsSchema.default(() => googleAnalyticsSchema.parse({})),
  comments: commentsSchema.default(() => commentsSchema.parse({})),
  newsletter: newsletterSchema.default(() => newsletterSchema.parse({})),
});
export const sections = ['blog', 'lab', 'life', 'archive'] as const;
export const publicNavigation = [
  { label: 'Home', href: '/' },
  { label: 'Archive', href: '/archive/' },
  { label: 'Projects', href: '/projects/' },
  { label: 'Life', href: '/life/' },
  { label: 'About', href: '/about/' },
];
export const publicNavigationFor = (collections = defaultCollections) =>
  publicNavigation.map((item) =>
    item.href === '/life/'
      ? { label: collections.life.name, href: collectionIndexRoute('life', collections) }
      : item,
  );
export const homeSlideSchema = z.object({
  id: z.string().regex(/^[\w-]{1,100}$/),
  source: z.enum(['entry', 'photo', 'custom']),
  reference: z.string().default(''),
  enabled: z.boolean().default(true),
  image: z
    .string()
    .refine((v) => !v || /^\/media\/[^?#]+$/.test(v), 'Choose a local image')
    .default(''),
  title: z.string().max(160).default(''),
  caption: z.string().max(500).default(''),
  alt: z.string().max(500).default(''),
  href: z.union([z.literal(''), link]).default(''),
  focalX: z.number().min(0).max(100).default(50),
  focalY: z.number().min(0).max(100).default(50),
});
export type HomeSlide = z.infer<typeof homeSlideSchema>;
const homeProfileSchema = z.object({
  showPortrait: z.boolean().default(true),
  showRole: z.boolean().default(true),
  showLocation: z.boolean().default(true),
  showAffiliations: z.boolean().default(false),
  showLinks: z.boolean().default(true),
});
const homeRecentSchema = z.object({
  sources: z
    .array(z.enum(['posts', 'lab']))
    .min(1)
    .max(2)
    .refine((sources) => new Set(sources).size === sources.length, 'Collections must be unique')
    .default(['posts', 'lab']),
  limit: z.number().int().min(1).max(12).default(6),
  showSummary: z.boolean().default(true),
  showDate: z.boolean().default(true),
  showCover: z.boolean().default(false),
});
export const homePinLimit = 12;
export const homeSchema = z.object({
  layout: z.enum(['profile', 'chapters']).default('profile'),
  motion: z.enum(['subtle', 'off']).default('subtle'),
  profile: homeProfileSchema.default(() => homeProfileSchema.parse({})),
  recent: homeRecentSchema.default(() => homeRecentSchema.parse({})),
  pinned: z
    .array(entrySchema.shape.id)
    .max(homePinLimit)
    .refine((ids) => new Set(ids).size === ids.length, 'Choose each pinned entry once')
    .default([]),
  slides: z
    .array(homeSlideSchema)
    .max(100)
    .refine(
      (slides) => new Set(slides.map((slide) => slide.id)).size === slides.length,
      'Chapter IDs must be unique',
    )
    .nullable()
    .default(null),
});
export type MediaAsset = {
  name: string;
  displayName?: string;
  downloadName?: string;
  shortCode?: string;
  publishForSharing?: boolean;
  url: string;
  bytes: number;
  modifiedAt: string;
  revision?: string;
  width?: number;
  height?: number;
  sourceId?: string;
  canEdit?: boolean;
};
export type PageDocument = { body: string; revision: string };
export const siteSchema = z.object({
  mediaProtection: mediaProtectionSchema,
  version: z.literal(1),
  name: z.string().min(1).max(50),
  url: z
    .string()
    .url()
    .refine((v) => {
      try {
        const url = new URL(v);
        return (
          url.protocol === 'https:' &&
          url.pathname === '/' &&
          !url.search &&
          !url.hash &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    }, 'Use an HTTPS site origin without a path, query, or credentials'),
  description: z.string().max(300),
  language: languageSchema,
  localization: localizationSchema.default(() => localizationSchema.parse({})),
  collections: collectionsSchema.default(() => collectionsSchema.parse({})),
  branding: brandingSchema.default(() => brandingSchema.parse({})),
  metadata: metadataSchema.default(() => metadataSchema.parse({})),
  navigationTools: navigationToolsSchema.default(() => navigationToolsSchema.parse({})),
  footer: footerSchema.default(() => footerSchema.parse({})),
  feeds: feedsSchema.default(() => feedsSchema.parse({})),
  profile: z.object({
    name: z.string().min(1).max(80),
    role: z.string().max(120),
    headline: z.string().min(1).max(160),
    bio: z.string().max(10000).default(''),
    email: z.union([z.email(), z.literal('')]).default(''),
    protectEmailLinks: z.boolean().default(true),
    portrait: z.string(),
    location: z.string().max(100),
    links: z.array(z.object({ label: z.string().min(1), href: link })).max(12),
    affiliations: z.array(z.object({ name: z.string(), description: z.string() })).max(8),
  }),
  navigation: z
    .array(
      z
        .object({ label: z.string().min(1), href: link })
        .transform((item) =>
          /^\/news\/?$/.test(item.href)
            ? { label: /^news$/i.test(item.label) ? 'Archive' : item.label, href: '/archive/' }
            : item,
        ),
    )
    .min(1)
    .max(10),
  homeSections: z
    .array(z.preprocess((value) => (value === 'news' ? 'archive' : value), z.enum(sections)))
    .max(4)
    .refine((v) => new Set(v).size === v.length, 'Sections must be unique'),
  home: homeSchema.default(() => homeSchema.parse({})),
  theme: themeSchema,
  about: z
    .object({
      guestbook: z
        .object({
          enabled: z.boolean().default(false),
          title: z.string().trim().min(1).max(100).default('Leave a note.'),
          description: z
            .string()
            .max(300)
            .default('A hello, a question, or something worth sharing.'),
        })
        .default(() => ({
          enabled: false,
          title: 'Leave a note.',
          description: 'A hello, a question, or something worth sharing.',
        })),
    })
    .default(() => ({
      guestbook: {
        enabled: false,
        title: 'Leave a note.',
        description: 'A hello, a question, or something worth sharing.',
      },
    })),
  reading: readingSchema.default(() => readingSchema.parse({})),
  publishing: publishingSchema.default(() => publishingSchema.parse({})),
  integrations: integrationsSchema.default(() => integrationsSchema.parse({})),
  mediaDelivery: z
    .object({
      mode: z.enum(['pages', 'r2']).default('pages'),
      bucket: z
        .string()
        .regex(/^$|^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
        .default(''),
      publicOrigin: z
        .string()
        .refine((value) => {
          if (!value) return true;
          try {
            const url = new URL(value);
            return (
              url.protocol === 'https:' &&
              !url.username &&
              !url.password &&
              url.pathname === '/' &&
              !url.search &&
              !url.hash &&
              !url.hostname.endsWith('.r2.dev')
            );
          } catch {
            return false;
          }
        }, 'Use an HTTPS production media origin without a path.')
        .default(''),
      prefix: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
        .default('media'),
    })
    .default(() => ({ mode: 'pages' as const, bucket: '', publicOrigin: '', prefix: 'media' })),
  cloudflare: z.object({
    accountId: z.string().regex(/^$|^[a-f0-9]{32}$/i),
    projectName: z.string().regex(/^$|^[a-z0-9][a-z0-9-]{0,57}$/),
    productionBranch: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[\w./-]+$/),
  }),
});
export type SiteConfig = z.infer<typeof siteSchema>;
export const photoAlbumSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  description: z.string().max(1000).default(''),
  cover: z.union([z.literal(''), z.string().startsWith('/media/')]).default(''),
  aliases: z.array(slugSchema).max(100).default([]),
});
export type PhotoAlbum = z.infer<typeof photoAlbumSchema>;
export const photoSchema = z.object({
  id: z.string().min(1),
  src: z.string().startsWith('/media/'),
  alt: z.string().min(1),
  caption: z.string(),
  album: z.string().min(1),
  takenAt: date,
  demo: z.boolean().default(false),
});
export type Photo = z.infer<typeof photoSchema>;
export const librarySchema = z
  .object({
    albums: z.array(photoAlbumSchema).max(500).default([]),
    mediaDetails: z
      .record(z.string().startsWith('/media/').max(1000), mediaMetadataSchema)
      .default({}),
    photos: z.array(photoSchema),
    news: z.array(
      z.object({
        id: z.string().min(1),
        date,
        text: z.string().min(1),
        href: z.union([z.literal(''), link]).default(''),
        demo: z.boolean().default(false),
      }),
    ),
  })
  .superRefine((library, ctx) => {
    const mediaCodes = new Set<string>();
    for (const [url, metadata] of Object.entries(library.mediaDetails))
      for (const code of [metadata.shortCode, ...metadata.shortAliases].filter(Boolean)) {
        if (mediaCodes.has(code))
          ctx.addIssue({
            code: 'custom',
            path: ['mediaDetails', url, 'shortCode'],
            message: 'Media short link “' + code + '” is already in use.',
          });
        mediaCodes.add(code);
      }
    const names = new Set<string>(),
      paths = new Set<string>(),
      ids = new Set<string>();
    for (const album of library.albums) {
      const name = album.name.normalize('NFC').toLowerCase();
      if (names.has(name) || ids.has(album.id))
        ctx.addIssue({
          code: 'custom',
          path: ['albums'],
          message: 'Album names and IDs must be unique.',
        });
      names.add(name);
      ids.add(album.id);
      for (const slug of [album.slug, ...album.aliases]) {
        const key = slug.normalize('NFC').toLowerCase();
        if (paths.has(key))
          ctx.addIssue({
            code: 'custom',
            path: ['albums'],
            message: 'Album paths and retained aliases must be unique.',
          });
        paths.add(key);
      }
    }
    for (const name of new Set(library.photos.map((p) => p.album)))
      if (
        !library.albums.some((a) => a.name === name) &&
        paths.has(headingSlug(name).normalize('NFC').toLowerCase())
      )
        ctx.addIssue({
          code: 'custom',
          path: ['albums'],
          message: 'An album path or alias conflicts with an existing photo album.',
        });
  });
export type Library = z.infer<typeof librarySchema>;
export type Repository = {
  projects?: import('./projects.js').Projects;
  projectsRevision?: string;
  about: PageDocument;
  site: SiteConfig;
  entries: ContentEntry[];
  library: Library;
  siteRevision: string;
  libraryRevision: string;
};
export type BuildResult = {
  id: string;
  outputDir: string;
  pages: number;
  media?: import('../engine/media-delivery.js').DeliveryManifest;
  manifest: string[];
  diagnostics: string[];
  sourceRevision: string;
  completedAt: string;
  totalBytes?: number;
  contentCounts?: { posts: number; lab: number; media: number };
  /** Canonical article paths captured for deployment verification; older builds omit this. */
  entryRoutes?: string[];
  collectionNames?: { posts: string; lab: string };
};
export type PublishResult = { url: string; project: string; buildId: string; completedAt: string };
export type JobState =
  | 'queued'
  | 'building'
  | 'validating'
  | 'syncing-media'
  | 'verifying-media'
  | 'verifying-deployment'
  | 'uploading'
  | 'succeeded'
  | 'failed';
export type Job = {
  id: string;
  /** Read response only; private journal content determines the selection revision. */
  revision?: string;
  action: 'build' | 'publish';
  state: JobState;
  failedAt?: Exclude<JobState, 'succeeded' | 'failed'>;
  mediaDelivery?: 'pages' | 'r2';
  target?: { canonicalUrl: string; project: string; branch: string };
  logs: string[];
  startedAt: string;
  completedAt?: string;
  build?: BuildResult;
  deployment?: PublishResult;
  error?: string;
  mediaProgress?: { total: number; done: number; uploaded: number; bytes: number };
};

export const formatDate = (value: string, short = false) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    month: short ? 'short' : 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
export const publicEntry = ({ file: _file, ...entry }: ContentEntry): PublicEntry => entry;

export function chronologicalEntries<
  T extends Pick<PublicEntry, 'id' | 'title' | 'publishedAt' | 'status'>,
>(entries: readonly T[]): T[] {
  return entries
    .filter((entry) => entry.status === 'published')
    .sort(
      (a, b) =>
        b.publishedAt.localeCompare(a.publishedAt) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
}
