import { t } from '../shared/i18n.js';
import { sourceComponents } from '../shared/source-components.js';
import { parseSourceTable, writeSourceTable, changeSourceTable } from '../shared/source-table.js';
import {
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  startCompletion,
  completionStatus,
} from '@codemirror/autocomplete';
import { lintGutter, linter, openLintPanel } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { Transaction } from '@codemirror/state';
import { z } from 'zod';
import { markdownCatalog, mathCompletions, codeMetadata } from '../shared/markdown-catalog.js';
import { markdownSnippets, instantiateSnippet } from '../shared/markdown-snippets.js';
import { inspectMarkdown, parseMarkdown, markdownText } from '../shared/markdown-analysis.js';
import { headingSlug } from '../shared/utils.js';
import { interactiveSchema } from '../shared/interactives.js';
import { entrySchema, routeFor } from '../shared/contracts.js';
import { markdownTable, readDelimited } from '../shared/tabular-data.js';
import { api, type Bootstrap, type MediaFile } from './api.js';
import { mathAt, fenceAt } from './source-language.js';
import { pseudocodeTemplate } from './pseudocode-intelligence.js';
import { quicksortSource } from '../shared/pseudocode-authoring.js';
export { startCompletion, completionStatus, openLintPanel };
export type CompletionTargets = {
  workspaceId?: string;
  notebook?: Bootstrap;
  linksAvailable?: boolean;
  mediaAvailable?: boolean;
  links: { label: string; url: string; status: string }[];
  media: { label: string; url: string }[];
};
export async function completionTargets(): Promise<CompletionTargets> {
  const [bootstrap, media] = await Promise.allSettled([
    api<Bootstrap>('bootstrap'),
    api<MediaFile[]>('media'),
  ]);
  return {
    notebook: bootstrap.status === 'fulfilled' ? bootstrap.value : undefined,
    linksAvailable: bootstrap.status === 'fulfilled',
    mediaAvailable: media.status === 'fulfilled',
    workspaceId: bootstrap.status === 'fulfilled' ? bootstrap.value.workspaceId : undefined,
    links:
      bootstrap.status === 'fulfilled'
        ? bootstrap.value.entries.map((e) => ({
            label: e.title,
            url: routeFor(e, bootstrap.value.site.collections),
            status: e.status,
          }))
        : [],
    media:
      media.status === 'fulfilled' ? media.value.map((m) => ({ label: m.name, url: m.url })) : [],
  };
}
const jsonSchema = z.toJSONSchema(interactiveSchema, {
  io: 'input',
  unrepresentable: 'any',
}) as any;
const metadataSchema = z.toJSONSchema(entrySchema, { io: 'input', unrepresentable: 'any' }) as any;
function schemaFor(schema: any, root = jsonSchema): any {
  if (schema?.$ref?.startsWith('#/'))
    return schema.$ref
      .slice(2)
      .split('/')
      .reduce((v: any, k: string) => v?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], root);
  return schema;
}
function jsonCompletions(
  context: CompletionContext,
  body: string,
  bodyStart: number,
): CompletionResult | null {
  const currentType = body.match(/"type"\s*:\s*"([\w-]+)"/)?.[1];
  const choices = jsonSchema.anyOf || jsonSchema.oneOf || [];
  let schema = choices.find((s: any) => s.properties?.type?.const === currentType) || choices[0];
  const match = /"([^"\\]*)$/.exec(body);
  const from = match ? bodyStart + match.index + 1 : context.pos;
  const prefix = match ? body.slice(0, match.index) : body;
  const stack: { schema: any; key: string; object: boolean; expectingKey: boolean }[] = [];
  let key = '',
    expectingKey = true;
  const tokens = prefix.match(/"(?:[^"\\]|\\.)*"|[{}[\]:,]|-?\d+(?:\.\d+)?|true|false|null/g) || [];
  for (const token of tokens) {
    if (token === '{' || token === '[') {
      if (stack.length)
        schema = schemaFor(stack.at(-1)!.object ? schema?.properties?.[key] : schema?.items);
      stack.push({ schema, key, object: token === '{', expectingKey: token === '{' });
      key = '';
      expectingKey = token === '{';
    } else if (token === '}' || token === ']') {
      stack.pop();
      schema = stack.at(-1)?.schema;
      expectingKey = false;
    } else if (token === ':') expectingKey = false;
    else if (token === ',') {
      expectingKey = stack.at(-1)?.object || false;
      key = '';
    } else if (expectingKey && token.startsWith('"')) {
      try {
        key = JSON.parse(token);
      } catch {
        return null;
      }
    }
  }
  schema = schemaFor(stack.at(-1)?.schema || schema);
  const quoted = !!match;
  const options: Completion[] = [];
  if (expectingKey)
    for (const name of Object.keys(schema?.properties || {}))
      options.push({ label: name, type: 'property', apply: quoted ? name : `"${name}": ` });
  else {
    const property = schemaFor(schema?.properties?.[key]);
    const values =
      key === 'type' && stack.length === 1
        ? choices.map((s: any) => s.properties?.type?.const).filter(Boolean)
        : property?.enum ||
          (property?.const !== undefined
            ? [property.const]
            : property?.type === 'boolean'
              ? [true, false]
              : []);
    for (const v of values)
      options.push({
        label: String(v),
        type: typeof v === 'boolean' ? 'keyword' : 'enum',
        apply: quoted ? String(v) : JSON.stringify(v),
      });
  }
  return options.length ? { from, options, validFor: /^[\w-]*$/ } : null;
}
function snippetCompletion(
  value: string,
  label: string,
  description: string,
  from: number,
): Completion {
  return {
    label,
    type: 'keyword',
    detail: description,
    apply: (view, completion, _from, to) => {
      let content = instantiateSnippet(value);
      // Add one useful tab stop without interpreting mathematical braces as snippet fields.
      const first = /^(\s*:{2,}\w+)\[([^\]]+)\]/m.exec(content);
      content = content.replace(/[{}]/g, (brace) => '\\' + brace);
      if (first) content = content.replace('[' + first[2] + ']', '[${1:' + first[2] + '}]');
      if (label === 'algorithm') content = content.replace(quicksortSource,
        pseudocodeTemplate(quicksortSource.replace(/^(?: {2})+/gm, (spaces) => '\t'.repeat(spaces.length / 2)), ['A', 'lo', 'hi'], 2));
      content += '${0}';
      snippet(content)(view, completion, from, to);
    },
  };
}
export function blogCompletions(targets: () => CompletionTargets) {
  return (context: CompletionContext): CompletionResult | null => {
    if (mathAt(context.state,context.pos)) return null;
    const activeFence=fenceAt(context.state,context.pos);
    const localLine=context.state.doc.lineAt(context.pos);
    const localBefore=context.state.doc.sliceString(localLine.from,context.pos);
    // Headers must be handled before the body guard, including an unfinished header at EOF.
    if (activeFence && context.pos <= activeFence.headerTo) {
      const typed = context.state.doc.sliceString(activeFence.infoFrom, context.pos);
      if (/^[\w-]+\s/.test(typed)) {
        const style = /\bstyle=["']?([\w-]*)$/.exec(typed);
        if (style && /^(?:pseudocode|pseudo|algorithm)(?:\s|$)/i.test(typed)) return {
          from: context.pos - style[1].length,
          options: ['algorithm', 'code'].map((label) => ({label, type:'enum'})),
          validFor: /^[\w-]*$/,
        };
        // Do not offer property names inside a quoted title or another metadata value.
        if (/(?:=\s*["'][^"']*|=\s*[^\s]*)$/.test(typed)) return null;
        const word = /[\w-]*$/.exec(typed)![0];
        return { from:context.pos-word.length, options:codeMetadata.map((item) => ({...item,type:'property'})), validFor:/^[\w-]*$/ };
      }
      return { from:activeFence.infoFrom, options:['pseudocode','pseudo','algorithm','interactive','mermaid','typescript','javascript','python','json','bash','text','latex','css','html'].map((label) => ({label,type:'keyword'})), validFor:/^[\w-]*$/ };
    }
    if (activeFence) return activeFence.info.split(/\s+/)[0] === 'interactive' && context.pos - activeFence.bodyFrom <= 65536
      ? jsonCompletions(context, context.state.doc.sliceString(activeFence.bodyFrom, context.pos), activeFence.bodyFrom) : null;
    // Ordinary prose must not copy and scan the entire document on every letter.
    if(!context.explicit && !activeFence && context.state.doc.line(1).text!=='---' &&
      !/(?:^\s*\/[\w-]*|:{1,}\w*|\[\^[\w-]*|:(?:ref|cite)\[[\w-]*|!?\[[^\]\n]*\]\([^\s)]*|:{2,}\w+[^\n]*\{[^}\n]*|\s*(?:`{3,}|~{3,})[^\n]*)$/.test(localBefore))return null;
    const before = context.state.doc.sliceString(0, context.pos),
      line = before.slice(before.lastIndexOf('\n') + 1);
    if (before.startsWith('---\n') && before.indexOf('\n---', 4) === -1) {
      const field = /^\s*([\w-]+):\s*["']?([\w-]*)$/.exec(line);
      if (field) {
        const property = metadataSchema.properties?.[field[1]];
        const values = property?.enum || (property?.type === 'boolean' ? [true, false] : []);
        return values.length
          ? {
              from: context.pos - field[2].length,
              options: values.map((v: any) => ({ label: String(v), type: 'enum' })),
              validFor: /^[\w-]*$/,
            }
          : null;
      }
      return {
        from: context.matchBefore(/[\w-]*$/)?.from ?? context.pos,
        options: Object.keys(entrySchema.shape)
          .filter((key) => key !== 'featured')
          .map((key) => ({ label: key, apply: key + ': ', type: 'property' })),
      };
    }
    const fences = [...before.matchAll(/^\s*(`{3,}|~{3,})([^\n]*)$/gm)];
    let fence: RegExpMatchArray | undefined;
    for (const f of fences) {
      if (!fence) fence = f;
      else if (f[1][0] === fence[1][0] && f[1].length >= fence[1].length && !f[2].trim())
        fence = undefined;
    }
    if (fence) {
      if (before.slice(fence.index).trimStart() === line.trimStart()) {
        if (/^\s*(?:`{3,}|~{3,})[\w-]+\s/.test(line)) {
          const word = /[\w-]*$/.exec(line)![0];
          return {
            from: context.pos - word.length,
            options: codeMetadata.map((item) => ({ ...item, type: 'property' })),
            validFor: /^[\w-]*$/,
          };
        }
        const language = /[\w-]*$/.exec(line)![0];
        return {
          from: context.pos - language.length,
          options: [
            'pseudocode',
            'pseudo',
            'algorithm',
            'interactive',
            'mermaid',
            'typescript',
            'javascript',
            'python',
            'json',
            'bash',
            'text',
            'latex',
            'css',
            'html',
          ].map((label) => ({ label, type: 'keyword' })),
          validFor: /^[\w-]*$/,
        };
      }
      if (fence[2].trim() !== 'interactive') return null;
      const start = before.indexOf('\n', fence.index) + 1;
      return jsonCompletions(context, before.slice(start), start);
    }
    const inlineCode = line.split(/(?<!\\)`/).length % 2 === 0;
    if (inlineCode) return null;
    const footnote = context.matchBefore(/\[\^[\w-]*$/);
    if (footnote) {
      const ids: string[] = [];
      const walk = (node: any) => {
        if (node.type === 'footnoteDefinition') ids.push(node.identifier);
        for (const child of node.children || []) walk(child);
      };
      walk(parseMarkdown(context.state.doc.toString()));
      return {
        from: footnote.from + 2,
        options: ids.map((label) => ({ label, type: 'reference' })),
        validFor: /^[\w-]*$/,
      };
    }
    const math = context.matchBefore(/\\[A-Za-z]*$/);
    if (
      math &&
      ((before.match(/(?<!\\)\$\$/g)?.length || 0) % 2 === 1 ||
        (line.match(/(?<!\\)\$(?!\$)/g)?.length || 0) % 2 === 1)
    )
      return {
        from: math.from + 1,
        options: mathCompletions.map((v) => ({
          label: v.split(/[_{]/)[0],
          detail: 'MathJax 4',
          apply: v,
          type: 'function',
        })),
        validFor: /^[A-Za-z]*$/,
      };
    const reference = context.matchBefore(/:(ref|cite)\[[\w-]*$/);
    if (reference) {
      const kind = reference.text.startsWith(':cite');
      const labels = [
        ...context.state.doc.toString().matchAll(/:::(\w+)[^\n]*\{[^\n}]*#([A-Za-z][\w-]*)/g),
      ];
      return {
        from: reference.from + reference.text.indexOf('[') + 1,
        options: labels
          .filter((m) =>
            kind
              ? m[1] === 'reference'
              : m[1] !== 'reference' && markdownCatalog.some((s) => s.name === m[1] && s.counter),
          )
          .map((m) => ({ label: m[2], detail: m[1], type: 'reference' })),
        validFor: /^[\w-]*$/,
      };
    }
    const link = context.matchBefore(/!?\[[^\]\n]*\]\([^\s)]*$/);
    if (link) {
      const typed = link.text.slice(link.text.indexOf('(') + 1);
      const from = link.from + link.text.indexOf('(') + 1;
      const headings: { label: string; url: string; status: string }[] = [],
        slugs = new Map<string, number>();
      const walk = (node: any) => {
        if (node.type === 'heading') {
          const text = markdownText(node),
            slug = headingSlug(text),
            count = (slugs.get(slug) || 0) + 1;
          slugs.set(slug, count);
          headings.push({
            label: text,
            url: '#' + slug + (count > 1 ? '-' + count : ''),
            status: 'heading',
          });
        }
        for (const child of node.children || []) walk(child);
      };
      walk(parseMarkdown(context.state.doc.toString()));
      const candidates = link.text.startsWith('!')
        ? targets().media.map((m) => ({ ...m, status: 'media' }))
        : typed.startsWith('#')
          ? headings
          : targets().links;
      return {
        from,
        options: candidates.map((m) => ({
          label: m.url,
          displayLabel: m.label,
          detail: m.status,
          type: 'reference',
        })),
        validFor: /^[^\s)]*$/,
      };
    }
    const attribute = /:{2,}(\w+)[^\n]*\{([^}\n]*)$/.exec(line);
    if (attribute) {
      const spec = markdownCatalog.find((s) => s.name === attribute[1]);
      const token = /([\w-]+)="([^"\n]*)$/.exec(attribute[2]);
      const word = context.matchBefore(/[\w-]*$/)!;
      return {
        from: token ? context.pos - token[2].length : word.from,
        options: token
          ? (spec?.attributes[token[1]]?.values || []).map((v) => ({ label: v, type: 'enum' }))
          : Object.keys(spec?.attributes || {}).map((key) => ({
              label: key,
              apply: key === 'id' ? '#label' : `${key}=""`,
              type: 'property',
              info: spec!.attributes[key].description,
            })),
        validFor: /^[\w-]*$/,
      };
    }
    const slash = /^\s*\/([\w-]*)$/.test(line);
    const directive = context.matchBefore(/:{1,}\w*$/);
    if (slash) {
      const from = context.pos - line.trimStart().length;
      return {
        from: from + 1,
        options: markdownSnippets.map((s) => snippetCompletion(s.value, s.type, s.label, from)),
        validFor: /^[\w-]*$/,
      };
    }
    if (directive) {
      const inline = directive.text.startsWith(':') && !directive.text.startsWith('::');
      if (inline && /[\w/]/.test(before[directive.from - 1] || '')) return null;
      const stack: { name: string; fence: string }[] = [];
      let code = '';
      for (const prior of before.slice(0, before.lastIndexOf('\n') + 1).split('\n')) {
        const f = /^\s*(`{3,}|~{3,})(.*)$/.exec(prior);
        if (f) {
          if (!code) code = f[1];
          else if (f[1][0] === code[0] && f[1].length >= code.length && !f[2].trim()) code = '';
          continue;
        }
        if (code) continue;
        const open = /^\s*(:{3,})([\w-]+)/.exec(prior),
          close = /^\s*(:{3,})\s*$/.exec(prior);
        if (open) stack.push({ name: open[2], fence: open[1] });
        if (close)
          while (stack.length && stack.at(-1)!.fence.length <= close[1].length) stack.pop();
      }
      const required: Record<string, string> = {
        tab: 'tabs',
        option: 'comparison',
        reference: 'references',
      };
      const options = markdownCatalog
        .filter(
          (s) =>
            (inline ? s.kind === 'inline' : true) &&
            (!required[s.name] || required[s.name] === stack.at(-1)?.name),
        )
        .map((s) => snippetCompletion(s.example, s.name, s.description, directive.from));
      if (/^\s*:{3,}$/.test(line) && stack.length)
        options.unshift({
          label: 'Close component',
          type: 'keyword',
          apply: (view, _completion, _from, to) =>
            view.dispatch({ changes: { from: directive.from, to, insert: stack.at(-1)!.fence } }),
          detail: `Close ${stack.at(-1)!.name}.`,
        });
      return {
        from: directive.from + (directive.text.match(/^:+/)?.[0].length || 0),
        options,
        validFor: /^[\w-]*$/,
      };
    }
    if (context.explicit && !line.trim())
      return {
        from: context.pos,
        options: markdownSnippets.map((s) =>
          snippetCompletion(s.value, s.type, s.label, context.pos),
        ),
      };
    return null;
  };
}
export function authoringExtensions(
  targets: () => CompletionTargets,
  onCount: (count: number) => void,
  analyze?: (source: string) => Promise<{
    diagnostics: ReturnType<typeof inspectMarkdown>['diagnostics'];
    superseded?: boolean;
  }>,
) {
  return [
    lintGutter(),
    linter(
      async (view) => {
        const source = view.state.doc.toString();
        const result = analyze ? await analyze(source) : inspectMarkdown(source);
        if ('superseded' in result && result.superseded) return [];
        const diagnostics = result.diagnostics;
        if (view.state.doc.toString() !== source) return [];
        onCount(diagnostics.length);
        return diagnostics.map((d) => ({
          from: Math.min(d.from, view.state.doc.length),
          to: Math.min(d.to, view.state.doc.length),
          severity: d.severity,
          message: `${d.message}${d.path ? ` (${d.path})` : ''}`,
          source: d.code,
          actions: d.fix
            ? [
                {
                  name: d.fix.label,
                  apply: (v: EditorView) => {
                    if (v.state.doc.toString() === source)
                      v.dispatch({
                        changes: d.fix!.changes,
                        annotations: Transaction.userEvent.of('input.fix'),
                      });
                  },
                },
              ]
            : undefined,
        }));
      },
      { delay: 700 },
    ),
  ];
}
export async function tableCommand(view: EditorView, command: string, clipboard?: string) {
  if (command === 'paste') {
    const text = clipboard ?? (await navigator.clipboard.readText());
    const insert = markdownTable(readDelimited(text));
    const range = view.state.selection.main;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: '\n\n' + insert + '\n\n' },
      annotations: Transaction.userEvent.of('input.table'),
    });
    return;
  }
  const source = view.state.doc.toString(),
    selection = view.state.selection.main;
  const block = sourceComponents(source).find(
    (item) => item.kind === 'table' && selection.head >= item.from && selection.head <= item.to,
  );
  if (!block) {
    if (command !== 'insert') throw new Error(t("Place the cursor inside a Markdown table first."));
    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: '\n\n| Column | Value |\n| :--- | ---: |\n| Example | 1 |\n\n',
      },
      annotations: Transaction.userEvent.of('input.table'),
    });
    return;
  }
  const table = parseSourceTable(block.source);
  let row = 0,
    column = 0;
  table.cells.forEach((cells, r) =>
    cells.forEach((cell, c) => {
      if (selection.head >= block.from + cell.from && selection.head <= block.from + cell.to) {
        row = r;
        column = c;
      }
    }),
  );
  const insert = writeSourceTable(changeSourceTable(table, command, row, column));
  view.dispatch({
    changes: { from: block.from, to: block.to, insert },
    effects: view.scrollSnapshot(),
    annotations: Transaction.userEvent.of('input.table'),
  });
  view.focus();
}
