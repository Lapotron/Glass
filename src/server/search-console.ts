import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, digest, ConflictError } from '../engine/store.js';
import {
  searchRows,
  type SearchDataset,
  type SearchImportReview,
} from '../shared/search-console.js';
export class SearchConsoleService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private root: string,
    private reviews = new Map<string, { review: SearchImportReview; previous: string }>(),
  ) {}
  private get folder() {
    return path.join(this.root, '.studio/search-console');
  }
  private async assertDirectory() {
    for (const folder of [path.join(this.root, '.studio'), this.folder]) {
      try {
        const stat = await fs.lstat(folder);
        if (stat.isSymbolicLink() || !stat.isDirectory())
          throw new Error('Search datasets cannot use symbolic links.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  async list() {
    await this.assertDirectory();
    let names: string[] = [];
    try {
      names = await fs.readdir(this.folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const result = [];
    for (const name of names.filter((n) => /^[a-f\d]{24}\.json$/.test(n))) {
      const data = await this.read(name.slice(0, -5));
      const { rows, ...meta } = data;
      result.push({ ...meta, rowCount: rows.length });
    }
    return result.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }
  async read(id: string): Promise<SearchDataset> {
    if (!/^[a-f\d]{24}$/.test(id)) throw new Error('Invalid search dataset.');
    await this.assertDirectory();
    const file = path.join(this.folder, id + '.json');
    if ((await fs.lstat(file)).isSymbolicLink())
      throw new Error('Search datasets cannot use symbolic links.');
    return JSON.parse(await fs.readFile(file, 'utf8'));
  }
  review(input: {
    source: string;
    name: string;
    property: string;
    from: string;
    to: string;
  }): SearchImportReview {
    for (const day of [input.from, input.to])
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        Number.isNaN(Date.parse(day)) ||
        new Date(day).toISOString().slice(0, 10) !== day
      )
        throw new Error('Use real report dates.');
    if (input.from > input.to) throw new Error('Report dates must be ordered.');
    const parsed = searchRows(input.source);
    if (
      parsed.dimension === 'date' &&
      parsed.rows.some(
        (row) =>
          row.label < input.from || row.label > input.to || !/^\d{4}-\d{2}-\d{2}$/.test(row.label),
      )
    )
      throw new Error('CSV dates do not match the selected report range.');
    const id = digest(
      JSON.stringify([input.property, parsed.dimension, input.from, input.to]),
    ).slice(0, 24);
    const dataset: SearchDataset = {
      id,
      name: input.name.slice(0, 200),
      property: input.property,
      dimension: parsed.dimension,
      from: input.from,
      to: input.to,
      timezone: 'America/Los_Angeles',
      importedAt: new Date().toISOString(),
      revision: digest(input.source),
      partial: parsed.dimension !== 'date',
      rows: parsed.rows,
    };
    return {
      id: randomUUID(),
      dataset,
      replaces: false,
      expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
    };
  }
  async prepare(input: Parameters<SearchConsoleService['review']>[0]) {
    const review = this.review(input);
    let previous = '';
    try {
      previous = (await this.read(review.dataset.id)).revision;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    review.replaces = Boolean(previous);
    if (this.reviews.size >= 5) this.reviews.clear();
    this.reviews.set(review.id, { review, previous });
    return review;
  }
  commit(id: string) {
    const work = this.queue.then(async () => {
      const item = this.reviews.get(id);
      if (!item || Date.parse(item.review.expiresAt) < Date.now())
        throw new Error('Search import review expired.');
      let revision = '';
      try {
        revision = (await this.read(item.review.dataset.id)).revision;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (revision !== item.previous)
        throw new ConflictError('Search dataset changed. Review the import again.');
      await this.assertDirectory();
      await fs.mkdir(this.folder, { recursive: true, mode: 0o700 });
      if ((await fs.lstat(this.folder)).isSymbolicLink())
        throw new Error('Search datasets cannot use symbolic links.');
      const file = path.join(this.folder, item.review.dataset.id + '.json');
      await atomicWrite(file, JSON.stringify(item.review.dataset));
      await fs.chmod(file, 0o600);
      this.reviews.delete(id);
      return item.review.dataset;
    });
    this.queue = work.catch(() => {});
    return work;
  }
  remove(id: string, revision: string) {
    const work = this.queue.then(async () => {
      if ((await this.read(id)).revision !== revision)
        throw new ConflictError('Search dataset changed. Refresh first.');
      await fs.rm(path.join(this.folder, id + '.json'));
      return { ok: true };
    });
    this.queue = work.catch(() => {});
    return work;
  }
}
