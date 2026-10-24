import { promises as fs } from 'node:fs';
import path from 'node:path';
import { emptyProjects, projectsSchema, projectSchema, type Projects } from '../shared/projects.js';
import { Store, digest, ConflictError } from './store.js';
import { commitFiles, fileDigest } from './file-transaction.js';

export async function readProjects(root: string) {
  const raw = await fs.readFile(path.join(root, 'content/projects.json'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return {
    value: raw ? projectsSchema.parse(JSON.parse(raw)) : emptyProjects(),
    revision: digest(raw),
    raw,
  };
}
export async function saveProjects(store: Store, value: unknown, revision: string) {
  return store.exclusive(async () => {
    const previous = await readProjects(store.root);
    if (previous.revision !== revision)
      throw new ConflictError(
        'Projects changed outside Studio. Your changes are preserved; reload before saving.',
      );
    const parsed = projectsSchema.parse(value),
      raw = JSON.stringify(parsed, null, 2) + '\n';
    if (raw === previous.raw) return { value: parsed, revision };
    await commitFiles(store.root, [
      {
        file: path.join(store.content, 'projects.json'),
        value: raw,
        expected: await fileDigest(path.join(store.content, 'projects.json')),
      },
      {
        file: path.join(store.root, '.studio/project-history', digest(raw) + '.json'),
        value: JSON.stringify({ previous: previous.value, afterRevision: digest(raw) }),
        expected: await fileDigest(
          path.join(store.root, '.studio/project-history', digest(raw) + '.json'),
        ),
      },
    ]);
    return { value: parsed, revision: digest(raw) };
  });
}
export async function undoProjects(store: Store, revision: string) {
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid Projects revision.');
  return store.exclusive(async () => {
    const current = await readProjects(store.root);
    if (current.revision !== revision)
      throw new ConflictError('Projects changed after this action. Reload before undoing.');
    const file = path.join(store.root, '.studio/project-history', revision + '.json');
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    if (record.afterRevision !== revision) throw new Error('Invalid project recovery record.');
    const value: Projects = projectsSchema.parse(record.previous),
      raw = JSON.stringify(value, null, 2) + '\n';
    await commitFiles(store.root, [
      { file: path.join(store.content, 'projects.json'), value: raw, expected: revision },
      { file, value: null, expected: digest(await fs.readFile(file)) },
    ]);
    return { value, revision: digest(raw) };
  });
}
const githubCache = new Map<string, { expires: number; value: unknown }>();
/** Read-only public GitHub import. No token, arbitrary URL, or reader dependency. */
export async function importGithubProject(repository: string, fetcher: typeof fetch = fetch) {
  if (
    !/^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(repository) ||
    repository.split('/').some((part) => /^\.+$/.test(part))
  )
    throw new Error('Use owner/repository from a public GitHub repository.');
  const key = repository.toLowerCase(),
    cached = githubCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const response = await fetcher(`https://api.github.com/repos/${repository}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Glass-Studio' },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error(
      response.status === 403 || response.status === 429
        ? 'GitHub rate limit reached. Try later or enter project details manually.'
        : 'This public repository could not be read.',
    );
  const raw = await response.text();
  if (raw.length > 128000) throw new Error('GitHub response is too large.');
  const repo = JSON.parse(raw);
  if (repo.private !== false || typeof repo.name !== 'string')
    throw new Error('Only public GitHub repositories can be imported.');
  const value = projectSchema.parse({
    id: crypto.randomUUID(),
    title: repo.name,
    description: String(repo.description || '').slice(0, 2000),
    technologies: [
      ...new Set(
        [repo.language, ...(repo.topics || [])].filter(
          (v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 40,
        ),
      ),
    ].slice(0, 24),
    status: repo.archived ? 'archived' : 'active',
    github: repository,
    updatedAt: repo.updated_at || '',
    links: [
      { label: 'Source', url: `https://github.com/${repository}` },
      ...(/^https:\/\//.test(repo.homepage || '')
        ? [{ label: 'Website', url: repo.homepage }]
        : []),
    ],
  });
  if (githubCache.size > 100) githubCache.clear();
  githubCache.set(key, { value, expires: Date.now() + 5 * 60000 });
  return value;
}
