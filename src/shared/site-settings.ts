import { z } from 'zod';

const image = z
  .string()
  .max(500)
  .refine((value) => {
    if (!value) return true;
    if (!/^\/media\/[^/?#\\]+\.(?:png|jpe?g|webp|avif|gif)$/i.test(value)) return false;
    try {
      const name = decodeURIComponent(value.slice('/media/'.length));
      return (
        !name.includes('/') &&
        !name.includes('\\') &&
        !Array.from(name).some((character) => character.charCodeAt(0) < 32)
      );
    } catch {
      return false;
    }
  }, 'Choose a local PNG, JPEG, WebP, AVIF, or GIF image.')
  .default('');
const color = z.string().regex(/^#[a-f\d]{6}$/i, 'Use a six-digit hex color.');
const handle = z
  .string()
  .regex(/^$|^@?[a-z\d_]{1,15}$/i, 'Use a handle such as @yourname.')
  .default('');
export const languageSchema = z
  .string()
  .max(35)
  .refine((value) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  }, 'Use a language code such as en, zh-CN, or ja.')
  .default('en');

export const brandingSchema = z.object({
  shortName: z.string().max(24).default(''),
  logo: image,
  darkLogo: image,
  showName: z.boolean().default(true),
  namePeriod: z.boolean().default(true),
  favicon: image,
  iconStyle: z.enum(['book', 'monogram']).default('book'),
  monogram: z.string().max(4).default(''),
  iconBackground: color.default('#3868e8'),
  themeColorLight: color.default('#f5f6f9'),
  themeColorDark: color.default('#131c2b'),
  appBackground: color.default('#f5f6f9'),
  appDisplay: z.enum(['browser', 'minimal-ui', 'standalone']).default('browser'),
});

export const metadataSchema = z.object({
  homeTitle: z.string().max(160).default(''),
  titleTemplate: z
    .string()
    .min(1)
    .max(200)
    .refine(
      (value) =>
        value.includes('{title}') &&
        (value.match(/\{[^}]*\}/g) || []).every((token) => ['{title}', '{site}'].includes(token)),
      'Include {title}; {site} is the optional site-name placeholder.',
    )
    .default('{title} — {site}'),
  locale: z
    .string()
    .regex(/^$|^[a-z]{2,3}_[A-Z]{2}$/, 'Use a locale such as en_US or zh_CN.')
    .default(''),
  socialImage: image,
  socialImageAlt: z.string().max(500).default(''),
  twitterSite: handle,
  twitterCreator: handle,
  twitterCard: z.enum(['auto', 'summary', 'summary_large_image']).default('auto'),
  indexing: z.boolean().default(true),
  followLinks: z.boolean().default(true),
  sitemap: z.boolean().default(true),
  maxImagePreview: z.enum(['large', 'standard', 'none']).default('large'),
  structuredData: z.boolean().default(true),
  author: z.boolean().default(true),
  googleVerification: z
    .string()
    .max(200)
    .regex(/^[a-z\d_-]*$/i, 'Paste only the verification token.')
    .default(''),
  bingVerification: z
    .string()
    .max(200)
    .regex(/^[a-z\d]*$/i, 'Paste only the verification token.')
    .default(''),
});

export const navigationToolsSchema = z.object({
  tools: z.boolean().default(true),
  search: z.boolean().default(true),
  themeToggle: z.boolean().default(true),
  readerSettings: z.boolean().default(true),
});

export const footerSchema = z.object({
  tagline: z.string().max(300).default('A little space for things that matter.'),
  copyrightName: z.string().max(100).default(''),
  since: z
    .number()
    .int()
    .min(0)
    .max(9999)
    .refine((value) => value === 0 || value >= 1900, 'Use 0 or a year from 1900 onward.')
    .default(0),
  showBrand: z.boolean().default(true),
  showSocialLinks: z.boolean().default(true),
  socialLinkLimit: z.number().int().min(0).max(12).default(2),
  showFeeds: z.boolean().default(true),
  externalLinks: z.boolean().default(true),
  links: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(50),
        href: z
          .string()
          .max(1000)
          .refine((value) => {
            if (
              value.includes('\\') ||
              Array.from(value).some((character) => character.charCodeAt(0) <= 32)
            )
              return false;
            try {
              const url = new URL(value, 'https://local.invalid');
              if (value.startsWith('/') && !value.startsWith('//'))
                return url.origin === 'https://local.invalid';
              return (
                (/^https:\/\//i.test(value) &&
                  url.protocol === 'https:' &&
                  !!url.hostname &&
                  !url.username &&
                  !url.password) ||
                (url.protocol === 'mailto:' && !!url.pathname)
              );
            } catch {
              return false;
            }
          }, 'Use an HTTPS, mailto, or local link.'),
      }),
    )
    .max(8)
    .default([]),
});

export const feedsSchema = z.object({
  rss: z.boolean().default(true),
  atom: z.boolean().default(false),
  json: z.boolean().default(false),
  title: z.string().max(160).default(''),
  description: z.string().max(500).default(''),
  limit: z.number().int().min(1).max(200).default(50),
  posts: z.boolean().default(true),
  lab: z.boolean().default(true),
  author: z.boolean().default(true),
});
