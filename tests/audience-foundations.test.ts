import { expect, it } from 'vitest';
import { audienceMetadata } from '../src/aca/audience.js';
import { accumulateAudience, vitalBucket, vitalQuantile } from '../src/shared/audience.js';
import { parseReadingRecords } from '../src/shared/reading.js';
import { parseCsv, searchRows } from '../src/shared/search-console.js';
it('derives approximate geography only from edge metadata and normalizes software without raw addresses', () => {
  const request = new Request('https://analytics.example/v1/events', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'CF-Connecting-IP': '192.0.2.9',
      'X-Country': 'WRONG',
    },
  });
  Object.defineProperty(request, 'cf', {
    value: {
      country: 'JP',
      continent: 'AS',
      region: 'Tokyo',
      city: 'Tokyo',
      latitude: '35.67621',
      longitude: '139.65031',
      asn: 2516,
      asOrganization: 'Example network',
      timezone: 'Asia/Tokyo',
    },
  });
  const result = audienceMetadata(request, { viewport: 'small' });
  expect(result).toMatchObject({
    country: 'JP',
    city: 'Tokyo',
    latitude: 35.68,
    longitude: 139.65,
    browser: 'Edge 130',
    os: 'Windows',
    device: 'desktop',
    viewport: 'small',
  });
  expect(JSON.stringify(result)).not.toContain('192.0.2.9');
  expect(JSON.stringify(result)).not.toContain('WRONG');
  expect(audienceMetadata(new Request('https://a.example'))).toMatchObject({
    country: 'Unknown',
    latitude: null,
    device: 'Unknown',
  });
});
it('bounds audience groups and retains a parseable unknown geography bucket', () => {
  const totals = {};
  for (let i = 0; i < 1200; i++)
    accumulateAudience(
      totals,
      JSON.stringify({ country: 'US', city: 'City ' + i, latitude: i % 80, longitude: 0 }),
      10000,
    );
  expect(Object.keys(totals).length).toBeLessThan(1050);
  for (const key of Object.keys(totals)) {
    const [dimension, value] = JSON.parse(key);
    if (dimension === 'geo') expect(() => JSON.parse(value)).not.toThrow();
  }
});
it('merges bounded vital histograms with explicit approximate upper quantiles', () => {
  const values = [0, 10, 50, 100, 300, 700, 1200, 2500, 4000, 8000];
  const bins = values.map((v) => ({ bucket: vitalBucket(v), count: 1 }));
  expect(vitalQuantile(bins, 0.75)).toBeGreaterThanOrEqual(2500);
  expect(vitalQuantile(bins, 0.75)).toBeLessThan(3251);
  expect(vitalQuantile([], 0.75)).toBeNull();
});
it('rejects foreign links, unsafe anchors and excessive reading-list imports', () => {
  const record = {
    id: 'note',
    title: 'Note',
    url: '/post/note/',
    revision: 'a'.repeat(64),
    bookmarked: true,
    progress: 25,
    anchor: '',
    quote: 'A paragraph',
    updatedAt: new Date().toISOString(),
  };
  expect(parseReadingRecords([record])).toEqual([record]);
  for (const url of ['//evil.example', 'https://evil.example/', 'javascript:alert(1)'])
    expect(() => parseReadingRecords([{ ...record, url }])).toThrow();
  expect(() => parseReadingRecords([{ ...record, anchor: 'onclick=evil' }])).toThrow();
  expect(() => parseReadingRecords(Array(501).fill(record))).toThrow();
});
it('parses quoted Search Console exports without mixing dimensions or averaging rates', () => {
  expect(parseCsv('a,b\r\n"with, comma","line\nnext"')).toEqual([
    ['a', 'b'],
    ['with, comma', 'line\nnext'],
  ]);
  const result = searchRows(
    '\uFEFFTop pages,Clicks,Impressions,CTR,Position\nhttps://example.org/a,2,10,20%,3.5\nhttps://example.org/b,3,90,3.33%,8',
  );
  expect(result.dimension).toBe('page');
  expect(result.rows[0].ctr).toBe(20);
  expect(result.rows[1].ctr).toBeCloseTo(3.333, 2);
  expect(searchRows('日期,点击次数,展示次数,点击率,平均排名\n2026-10-20,1,20,5%,2').dimension).toBe(
    'date',
  );
  expect(() => parseCsv('a,b\n"broken')).toThrow();
  expect(() => searchRows('Page,Clicks,Impressions\na,1,2\na,3,4')).toThrow('repeats');
});
