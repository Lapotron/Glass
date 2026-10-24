import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConflictError, digest } from '../engine/store.js';
import { siteSchema, librarySchema } from '../shared/contracts.js';
import {
  connectionFields,
  type ConnectionField,
  type ConnectionSummary,
  type ConnectionUpdate,
  type RuntimeSummary,
  type RuntimeValues,
} from '../shared/local-settings.js';

export const applicationRoot = path.resolve(import.meta.dirname, '../..');
const secret = z
  .string()
  .trim()
  .min(8)
  .max(4096)
  .regex(/^\S+$/, 'Credentials cannot contain whitespace');
const connectionsSchema = z
  .object({
    cloudflareApiToken: secret.optional(),
    cloudflareBuildsApiToken: secret.optional(),
    workersBuildsDeployHook: z.url().refine(value => /^https:\/\/api\.cloudflare\.com\/client\/v4\/workers\/builds\/deploy_hooks\/[\w-]+$/.test(value), 'Use the private Workers Builds Deploy Hook URL from Cloudflare.').optional(),
    acaReportToken: secret.optional(),
    r2AccessKeyId: secret.optional(),
    r2SecretAccessKey: secret.optional(),
  })
  .strict();
const runtimeSchema = z
  .object({
    port: z.number().int().min(1024).max(65535).optional(),
    notebookRoot: z.string().min(1).max(4096).optional(),
  })
  .strict();
const environmentNames: Record<ConnectionField, string> = {
  cloudflareApiToken: 'CLOUDFLARE_API_TOKEN',
  cloudflareBuildsApiToken: 'BUILDS_API_TOKEN',
  workersBuildsDeployHook: 'BUILDS_DEPLOY_HOOK',
  acaReportToken: 'ACA_REPORT_TOKEN',
  r2AccessKeyId: 'R2_ACCESS_KEY_ID',
  r2SecretAccessKey: 'R2_SECRET_ACCESS_KEY',
};
export class PrivateSettings<T extends object> {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    readonly file: string,
    readonly schema: z.ZodType<T>,
  ) {}
  async read() {
    let raw = '';
    try {
      if (
        (await fs.lstat(path.dirname(this.file))).isSymbolicLink() ||
        (await fs.lstat(this.file)).isSymbolicLink()
      )
        throw new Error('Private settings cannot use symbolic links.');
      raw = await fs.readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      return { value: this.schema.parse(raw ? JSON.parse(raw) : {}), revision: digest(raw) };
    } catch {
      throw new Error(
        'Private settings could not be read. Check the local configuration file before saving.',
      );
    }
  }
  async save(value: T, revision: string) {
    const work = this.pending.then(async () => {
      const previous = await this.read();
      if (previous.revision !== revision)
        throw new ConflictError(
          'Local settings changed. Reload their status before saving; your draft is preserved.',
        );
      const parsed = this.schema.parse(value),
        directory = path.dirname(this.file);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      if ((await fs.lstat(directory)).isSymbolicLink())
        throw new Error('Private settings cannot use symbolic links.');
      const temporary = this.file + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, JSON.stringify(parsed, null, 2), { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, this.file);
        await fs.chmod(this.file, 0o600);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      return this.read();
    });
    this.pending = work.catch(() => undefined);
    return work;
  }
}
export class ConnectionSettings {
  private store: PrivateSettings<z.infer<typeof connectionsSchema>>;
  constructor(
    root: string,
    readonly environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.store = new PrivateSettings(
      path.join(root, '.studio/connections.json'),
      connectionsSchema,
    );
  }
  async summary(): Promise<ConnectionSummary> {
    const saved = await this.store.read();
    return {
      revision: saved.revision,
      fields: Object.fromEntries(
        connectionFields.map((key) => [
          key,
          {
            configured: Boolean(saved.value[key] || this.environment[environmentNames[key]]),
            source: saved.value[key]
              ? 'studio'
              : this.environment[environmentNames[key]]
                ? 'environment'
                : 'none',
          },
        ]),
      ) as ConnectionSummary['fields'],
    };
  }
  async values(): Promise<NodeJS.ProcessEnv> {
    const saved = await this.store.read(),
      values: NodeJS.ProcessEnv = {};
    for (const key of connectionFields)
      values[environmentNames[key]] = saved.value[key] || this.environment[environmentNames[key]];
    return values;
  }
  async update(input: ConnectionUpdate) {
    const request = z
      .object({
        revision: z.string(),
        set: connectionsSchema.optional(),
        remove: z.array(z.enum(connectionFields)).optional(),
      })
      .strict()
      .parse(input);
    const saved = await this.store.read(),
      value = { ...saved.value, ...request.set };
    for (const key of request.remove || []) delete value[key];
    // A saved pair is atomic; partial replacement is allowed only when its companion already exists.
    if (Boolean(value.r2AccessKeyId) !== Boolean(value.r2SecretAccessKey))
      throw new Error('Save or remove both R2 credentials together.');
    await this.store.save(value, request.revision);
    return this.summary();
  }
  async importEnvironment(revision: string) {
    const set: Partial<Record<ConnectionField, string>> = {};
    for (const key of connectionFields)
      if (this.environment[environmentNames[key]])
        set[key] = this.environment[environmentNames[key]]!;
    return this.update({ revision, set });
  }
}
export class LauncherSettings {
  readonly store: PrivateSettings<z.infer<typeof runtimeSchema>>;
  constructor(
    readonly installRoot: string,
    readonly active: RuntimeValues,
  ) {
    this.store = new PrivateSettings(
      path.join(installRoot, '.studio/launcher.json'),
      runtimeSchema,
    );
  }
  async summary(): Promise<RuntimeSummary> {
    const saved = await this.store.read();
    const value = { ...this.active, ...saved.value };
    return {
      revision: saved.revision,
      saved: value,
      active: this.active,
      restartRequired:
        value.port !== this.active.port || value.notebookRoot !== this.active.notebookRoot,
    };
  }
  async update(value: RuntimeValues, revision: string) {
    const parsed = runtimeSchema.required().parse(value);
    if (!path.isAbsolute(parsed.notebookRoot))
      throw new Error('Choose an absolute notebook-folder path.');
    let root: string;
    try {
      root = await fs.realpath(parsed.notebookRoot);
      await fs.access(root, constants.R_OK | constants.W_OK);
      siteSchema.parse(JSON.parse(await fs.readFile(path.join(root, 'content/site.json'), 'utf8')));
      librarySchema.parse(
        JSON.parse(await fs.readFile(path.join(root, 'content/library.json'), 'utf8')),
      );
    } catch {
      throw new Error(
        'Choose a writable notebook folder containing valid content/site.json and content/library.json.',
      );
    }
    await this.store.save({ ...parsed, notebookRoot: root }, revision);
    return this.summary();
  }
}
export async function resolveLaunchOptions(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
  installRoot = applicationRoot,
) {
  const saved = (
    await new PrivateSettings(path.join(installRoot, '.studio/launcher.json'), runtimeSchema).read()
  ).value;
  const remaining: string[] = [],
    explicit: Partial<RuntimeValues> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' || args[i] === '--root') {
      const name = args[i],
        value = args[++i];
      if (!value) throw new Error(`${name} needs a value.`);
      if (name === '--port') explicit.port = Number(value);
      else explicit.notebookRoot = path.resolve(value);
    } else remaining.push(args[i]);
  }
  const values = runtimeSchema.required().parse({
    port: explicit.port ?? saved.port ?? Number(environment.PORT || 4310),
    notebookRoot:
      explicit.notebookRoot ?? saved.notebookRoot ?? environment.BLOG_ROOT ?? installRoot,
  });
  return {
    ...values,
    notebookRoot: await fs.realpath(path.resolve(values.notebookRoot)),
    args: remaining,
  };
}
export function redactSecrets(message: string, values: NodeJS.ProcessEnv) {
  let result = message.replace(/(Bearer\s+|CLOUDFLARE_API_TOKEN[=: ]+)[^\s]+/gi, '$1[redacted]');
  for (const name of Object.values(environmentNames))
    if (values[name]) result = result.split(values[name]!).join('[redacted]');
  return result;
}
