import { afterEach, expect, it } from 'vitest';
import { installUiLocale, isUiCatalog, t, uiDate, uiNumber, uiPreferenceKey } from '../src/shared/i18n.js';
import { localizationSchema, collectionLabel } from '../src/shared/localization.js';
import { defaultCollections } from '../src/shared/collections.js';
import hans from '../src/locales/zh-Hans.public.json';
import hant from '../src/locales/zh-Hant.public.json';

afterEach(() => installUiLocale('en', {}));

it('uses explicit locale catalogs without changing author values or swallowing missing diagnostics', () => {
  installUiLocale('zh-Hans', hans);
  expect(t('Reader settings')).toBe('阅读设置');
  expect(t('View image: {value0}', { value0: 'A <portrait> & sea' })).toContain('A <portrait> & sea');
  expect(t('An unknown diagnostic')).toBe('An unknown diagnostic');
  installUiLocale('zh-Hant', hant);
  expect(t('Reader settings')).toBe('閱讀設定');
  expect(uiNumber(1234)).toBe(new Intl.NumberFormat('zh-Hant').format(1234));
  expect(uiDate('2026-10-22T23:59:00Z', { year:'numeric',month:'2-digit',day:'2-digit' })).toContain('2026');
  expect(uiPreferenceKey('reader')).not.toBe(uiPreferenceKey('studio'));
});

it('bounds optional caches and preserves collection naming fallback without changing paths', () => {
  expect(isUiCatalog(null)).toBe(false);
  expect(isUiCatalog(['a'])).toBe(false);
  expect(isUiCatalog({ phrase: { html:'<b>unsafe</b>' } })).toBe(false);
  const localization = localizationSchema.parse({ labels: {'zh-Hans': {posts:{name:'  文章  ',singular:''}}} });
  expect(localization.enabled).toBe(true);
  expect(localizationSchema.parse({enabled:false}).enabled).toBe(false);
  const site = { collections:defaultCollections,localization };
  expect(collectionLabel(site,'posts','name','zh-Hans')).toBe('文章');
  expect(collectionLabel(site,'posts','singular','zh-Hans')).toBe(defaultCollections.posts.singular);
  expect(collectionLabel(site,'posts','name','en')).toBe(defaultCollections.posts.name);
  expect(collectionLabel(site,'posts','name','zh-Hant')).toBe(defaultCollections.posts.name);
  expect(site.collections.posts.path).toBe(defaultCollections.posts.path);
  expect(localizationSchema.safeParse({labels:{'zh-Hans':{posts:{name:'x'.repeat(41)}}}}).success).toBe(false);
});
