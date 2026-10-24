import { z } from 'zod';
import type { DiscussionCheck } from '../shared/discussions.js';

export const discussionCheckSchema = z.object({
  repo: z
    .string()
    .max(201)
    .regex(/^[\w.-]+\/[\w.-]+$/, 'Use owner/repository.'),
  repoId: z.string().max(100).default(''),
  categoryId: z.string().max(100).default(''),
});
const providerResult = z.object({
  repositoryId: z.string().min(1).max(100),
  categories: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        name: z.string().min(1).max(100),
        emoji: z.string().max(100).default(''),
      }),
    )
    .max(100),
});

export async function checkDiscussionConfiguration(
  value: z.infer<typeof discussionCheckSchema>,
  request: typeof fetch = fetch,
): Promise<DiscussionCheck> {
  const base = { repositoryId: '', categories: [], issues: [] };
  try {
    const url = new URL('https://giscus.app/api/discussions/categories');
    url.searchParams.set('repo', value.repo);
    const response = await request(url, {
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok)
      return {
        ...base,
        status: response.status >= 500 || response.status === 429 ? 'unreachable' : 'invalid',
        issues: [
          response.status === 404
            ? 'Repository not found. Check its name and make sure it is public.'
            : response.status === 403
              ? 'Giscus could not access this repository. Check that Discussions are enabled and the Giscus app is installed; the provider may also be temporarily unavailable.'
              : 'Giscus is temporarily unavailable. Your saved configuration has not changed.',
        ],
      };
    const result = providerResult.parse(await response.json());
    const issues: string[] = [];
    if (value.repoId && value.repoId !== result.repositoryId)
      issues.push('The saved repository ID does not match this repository.');
    if (value.categoryId && !result.categories.some((category) => category.id === value.categoryId))
      issues.push('The saved category ID was not found in this repository.');
    if (!result.categories.length)
      issues.push('Enable GitHub Discussions and create a discussion category.');
    return { ...result, issues, status: issues.length ? 'invalid' : 'ready' };
  } catch {
    return {
      ...base,
      status: 'unreachable',
      issues: [
        'Giscus could not be reached. Check your connection and try again. Your settings are unchanged.',
      ],
    };
  }
}
