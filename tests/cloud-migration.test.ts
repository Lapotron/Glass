import { it, expect } from 'vitest';
import { conflictingCloudChanges } from '../src/shared/cloud-migration.js';
it('retains incoming settings when newer cloud choices are already present and detects conflicting edits', () => {
  const seed = {
    name: 'New notebook',
    home: { layout: 'chapters' },
    navigation: ['home', 'archive'],
  };
  const cloud = {
    ...seed,
    home: { layout: 'profile' },
    navigation: ['home', 'archive', 'projects'],
  };
  const incoming = {
    name: 'My existing notebook',
    home: { layout: 'profile', pinned: ['article-id'] },
    navigation: ['home', 'archive', 'projects'],
  };
  expect(conflictingCloudChanges(seed, cloud, incoming)).toEqual([]);
  expect(conflictingCloudChanges(seed, { ...cloud, name: 'A newer cloud name' }, incoming)).toEqual(
    ['name'],
  );
  expect(
    conflictingCloudChanges(seed, { ...cloud, home: { layout: 'something else' } }, incoming),
  ).toEqual(['home.layout']);
});
