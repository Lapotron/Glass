import ts from 'typescript';
import type { VirtualCodeFile } from '../shared/code-projects.js';

const rawLibs = import.meta.glob('../../node_modules/typescript/lib/lib.*.d.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const libs = new Map(
  Object.entries(rawLibs).map(([name, text]) => ['/lib/' + name.split('/').at(-1), text]),
);
type Project = {
  files: Map<string, VirtualCodeFile>;
  versions: Map<string, number>;
  host: ts.LanguageServiceHost;
  service?: ts.LanguageService;
  used: number;
};
const projects = new Map<string, Project>();
const documents = ts.createDocumentRegistry(true, '/');
let useSequence = 0;
let revision = 0;
const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  allowJs: true,
  checkJs: true,
  strict: false,
  noEmit: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
};
const normalize = (file: string) => file.replaceAll('\\', '/');
function project(group: string): Project {
  const known = projects.get(group);
  if (known) return known;
  const files = new Map<string, VirtualCodeFile>(),
    versions = new Map<string, number>();
  const read = (name: string) => files.get(normalize(name))?.text ?? libs.get(normalize(name));
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: (name) => String(versions.get(name) || 0),
    getScriptSnapshot: (name) => {
      const text = read(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => `/project/${group}`,
    getDefaultLibFileName: () => '/lib/lib.es2022.full.d.ts',
    fileExists: (name) => read(name) !== undefined,
    readFile: read,
    readDirectory: () => [],
    directoryExists: (name) =>
      [...files.keys(), ...libs.keys()].some((file) =>
        file.startsWith(normalize(name).replace(/\/$/, '') + '/'),
      ),
  };
  const result: Project = { files, versions, host, used: 0 };
  projects.set(group, result);
  return result;
}
function sync(files: VirtualCodeFile[]) {
  const groups = new Set(files.map((file) => file.group));
  for (const [name, value] of projects)
    if (!groups.has(name)) {
      value.service?.dispose();
      projects.delete(name);
    }
  for (const group of groups) {
    const value = project(group),
      selected = files.filter((file) => file.group === group);
    for (const name of value.files.keys())
      if (!selected.some((file) => file.name === name)) {
        value.files.delete(name);
        value.versions.delete(name);
      }
    for (const file of selected)
      if (value.files.get(file.name)?.text !== file.text) {
        value.files.set(file.name, file);
        value.versions.set(file.name, (value.versions.get(file.name) || 0) + 1);
      }
  }
}
const display = (parts: ts.SymbolDisplayPart[] | undefined) => ts.displayPartsToString(parts);
function run(action: string, file: string, pos: number, args: any) {
  const value = [...projects.values()].find((project) => project.files.has(file));
  if (!value) throw new Error('The code block changed. Retry the command.');
  const service = (value.service ??= ts.createLanguageService(value.host, documents));
  value.used = ++useSequence;
  const active = [...projects.values()]
    .filter((project) => project.service)
    .sort((a, b) => b.used - a.used);
  for (const cold of active.slice(12)) {
    cold.service?.dispose();
    cold.service = undefined;
  }
  if (action === 'complete')
    return (
      service
        .getCompletionsAtPosition(file, pos, {
          includeCompletionsForModuleExports: false,
          includeInsertTextCompletions: true,
        })
        ?.entries.slice(0, 500)
        .map((entry) => ({
          label: entry.name,
          kind: entry.kind,
          insert: entry.insertText,
          span: entry.replacementSpan,
          sort: entry.sortText,
        })) || []
    );
  if (action === 'details') {
    const details = service.getCompletionEntryDetails(
      file,
      pos,
      args.name,
      {},
      undefined,
      {},
      undefined,
    );
    return details
      ? { signature: display(details.displayParts), documentation: display(details.documentation) }
      : null;
  }
  if (action === 'hover') {
    const info = service.getQuickInfoAtPosition(file, pos);
    return info
      ? {
          signature: display(info.displayParts),
          documentation: display(info.documentation),
          span: info.textSpan,
        }
      : null;
  }
  if (action === 'signature') {
    const info = service.getSignatureHelpItems(file, pos, undefined);
    if (!info) return null;
    const item = info.items[info.selectedItemIndex];
    return {
      signature:
        display(item.prefixDisplayParts) +
        item.parameters
          .map((parameter) => display(parameter.displayParts))
          .join(display(item.separatorDisplayParts)) +
        display(item.suffixDisplayParts),
      documentation: display(item.parameters[info.argumentIndex]?.documentation),
      argument: info.argumentIndex,
    };
  }
  if (action === 'definitions')
    return (
      service.getDefinitionAtPosition(file, pos)?.map((def) => ({
        file: def.fileName,
        span: def.textSpan,
        name: def.name,
        library: !value.files.has(def.fileName),
      })) || []
    );
  if (action === 'references')
    return (
      service
        .getReferencesAtPosition(file, pos)
        ?.map((ref) => ({ file: ref.fileName, span: ref.textSpan, write: ref.isWriteAccess })) || []
    );
  if (action === 'rename') {
    const info = service.getRenameInfo(file, pos);
    if (!info.canRename) throw new Error(info.localizedErrorMessage);
    return (
      service
        .findRenameLocations(file, pos, false, false, true)
        ?.filter((location) => value.files.has(location.fileName))
        .map((location) => ({
          file: location.fileName,
          span: location.textSpan,
          prefix: location.prefixText || '',
          suffix: location.suffixText || '',
        })) || []
    );
  }
  if (action === 'fixes')
    return service
      .getCodeFixesAtPosition(file, args.from, args.to, args.codes, {}, {})
      .filter((fix) =>
        fix.changes.every((change) => !change.isNewFile && value.files.has(change.fileName)),
      )
      .map((fix) => ({
        description: fix.description,
        changes: fix.changes.map((change) => ({
          file: change.fileName,
          edits: change.textChanges,
        })),
      }));
  if (action === 'diagnostics')
    return [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)].map(
      (diagnostic) => ({
        from: diagnostic.start || 0,
        to: (diagnostic.start || 0) + (diagnostic.length || 1),
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        severity: diagnostic.category === ts.DiagnosticCategory.Warning ? 'warning' : 'error',
        code: diagnostic.code,
      }),
    );
  throw new Error('Unknown language-service command.');
}
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'sync') {
      sync(data.files);
      revision = data.revision;
      return;
    }
    if (data.revision !== revision)
      throw new Error('Code analysis was superseded by a newer edit.');
    self.postMessage({
      id: data.id,
      revision,
      result: run(data.action, data.file, data.pos, data.args),
    });
  } catch (error) {
    self.postMessage({ id: data.id, revision, error: (error as Error).message });
  }
};
