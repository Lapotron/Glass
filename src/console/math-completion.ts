import {
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { hoverTooltip, EditorView, showTooltip } from '@codemirror/view';
import {
  mathCommandCatalog,
  mathCommandSource,
  mathEnvironments,
  type MathCommand,
  type MathSettings,
} from '../shared/math-authoring.js';
import { mathMacros, type MathMacro } from '../shared/math-symbols.js';
import { mathAt } from './source-language.js';
import { api } from './api.js';

export type MathCompletionContext = { math?: MathSettings; macros: MathMacro[] };
const exampleCache = new Map<string, string>();
const literal = (text: string) => text.replace(/[{}]/g, (brace) => '\\' + brace);
const sectionRank = (name: string) =>
  [
    'This document',
    'Structure',
    'Calculus',
    'Physics',
    'Greek',
    'Symbols',
    'Relations',
    'Operators',
    'Functions',
    'Typography',
    'Advanced mathematics',
    'Cancellation',
    'Chemistry',
    'Units',
    'Macros',
    'Environments',
  ].indexOf(name);
export function mathCommandSnippet(command: MathCommand) {
  if (
    command.name === 'sum' ||
    command.name === 'prod' ||
    command.name === 'int' ||
    command.name === 'oint' ||
    command.name === 'lim'
  )
    return `\\${command.name}_\\{\${1:a}\\}^\\{\${2:b}\\}\${0}`;
  return `\\${command.name}${(command.arguments || []).map((arg, index) => `\\{\${${index + 1}:${literal(arg)}}\\}`).join('')}\${0}`;
}
function commandsFor(
  info: MathCompletionContext,
  before: number,
  local: MathMacro[] = [],
): MathCommand[] {
  const enabled = new Set(info.math?.packages || []),
    commands = new Map<string, MathCommand>();
  for (const command of mathCommandCatalog)
    if (!command.package || enabled.has(command.package)) commands.set(command.name, command);
  for (const macro of [...info.macros, ...local])
    if (macro.from < before)
      commands.set(macro.name, {
        name: macro.name,
        description: 'Document-defined macro',
        category: 'This document',
        optional: macro.optional,
        arguments: Array.from(
          { length: macro.arguments - Number(macro.optional !== undefined) },
          (_, i) => `argument ${i + 1 + Number(macro.optional !== undefined)}`,
        ),
        example: `\\${macro.name}${Array.from({ length: macro.arguments - Number(macro.optional !== undefined) }, () => '{x}').join('')}`,
      });
  return [...commands.values()];
}
function commandInfo(command: MathCommand, settings?: MathSettings, macros: MathMacro[] = []) {
  const dom = document.createElement('div');
  dom.className = 'math-completion-info';
  const signature = document.createElement('code');
  signature.textContent = `\\${command.name}${command.optional ? `[${command.optional}]` : ''}${(command.arguments || []).map((arg) => `{${arg}}`).join('')}`;
  const description = document.createElement('p');
  description.textContent = command.description;
  const origin = document.createElement('small');
  origin.textContent = command.package || command.category;
  dom.append(signature, description, origin);
  const example = mathCommandSource(command),
    definitions =
      command.category === 'This document' ? macros.map((macro) => macro.raw).join('\n') : '',
    key = JSON.stringify([settings, example, definitions]);
  const drawing = document.createElement('div');
  drawing.className = 'math-completion-example';
  dom.append(drawing);
  const cached = exampleCache.get(key);
  if (cached) drawing.innerHTML = cached;
  else if (command.category !== 'Macros') {
    const controller = new AbortController();
    const prefix = definitions ? `$$\n${definitions}\n$$\n\n` : '';
    const body = definitions
      ? {
          source: prefix + '$' + example + '$',
          ranges: [{ from: prefix.length, to: prefix.length + example.length + 2 }],
          math: settings,
        }
      : { expressions: [{ source: example, display: false }], math: settings };
    void api<{ results: { html?: string }[] }>('authoring/math-preview', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]),
    })
      .then(({ results }) => {
        if (results[0]?.html) {
          exampleCache.set(key, results[0].html);
          while (exampleCache.size > 96) exampleCache.delete(exampleCache.keys().next().value!);
          if (dom.isConnected) drawing.innerHTML = results[0].html;
        }
      })
      .catch(() => {});
    return { dom, destroy: () => controller.abort() };
  }
  return { dom };
}
export function mathCompletion(get: () => MathCompletionContext) {
  return (context: CompletionContext): CompletionResult | null => {
    const region = mathAt(context.state, context.pos);
    if (!region) return null;
    const before = context.state.doc.sliceString(region.from, context.pos),
      info = get();
    const environment = /\\(begin|end)\{([\w*]*)$/.exec(before);
    if (environment) {
      const stack: string[] = [];
      for (const match of before.slice(0, environment.index).matchAll(/\\(begin|end)\{([\w*]+)\}/g))
        if (match[1] === 'begin') stack.push(match[2]);
        else if (stack.at(-1) === match[2]) stack.pop();
      const environments = [
        ...mathEnvironments,
        ...(info.math?.packages?.includes('mathtools')
          ? ['dcases', 'rcases', 'matrix*', 'pmatrix*', 'bmatrix*', 'multlined']
          : []),
        ...(info.math?.packages?.includes('amscd') ? ['CD'] : []),
      ];
      return {
        from: context.pos - environment[2].length,
        options: (environment[1] === 'end' ? stack.slice(-1) : environments).map((name) => ({
          label: name,
          type: 'type',
          detail: 'Math environment',
          apply:
            environment[1] === 'begin'
              ? (view, completion, from, to) =>
                  snippet(`${name}\\}\n  \${1:expression}\n\\end\\{${name}\\}\${0}`)(
                    view,
                    completion,
                    from,
                    context.state.doc.sliceString(to, to + 1) === '}' ? to + 1 : to,
                  )
              : name,
        })),
        validFor: /^[\w*]*$/,
      };
    }
    const delimiter = /\\(left|right)\s*([^\s{}]*)$/.exec(before);
    if (delimiter)
      return {
        from: context.pos - delimiter[2].length,
        options: (delimiter[1] === 'left'
          ? ['(', '[', '\\{', '|', '\\langle', '.']
          : [')', ']', '\\}', '|', '\\rangle', '.']
        ).map((label) => ({ label, type: 'keyword' })),
      };
    const word = context.matchBefore(/\\[A-Za-z]*$|[\p{L}]+$/u);
    if (!word || (!word.text.startsWith('\\') && !context.explicit)) return null;
    const query = word.text.replace(/^\\/, '').toLocaleLowerCase();
    const local = mathMacros(context.state.doc.sliceString(region.from, region.to), region.from);
    const prefixCategories = new Set(
      commandsFor(info, context.pos, local)
        .filter((command) => command.name.toLocaleLowerCase().startsWith(query))
        .map((command) => command.category),
    );
    const options: Completion[] = commandsFor(info, context.pos, local)
      .filter(
        (command) =>
          !query ||
          `${command.name} ${command.description} ${command.aliases || ''} ${command.symbol || ''}`
            .toLocaleLowerCase()
            .includes(query),
      )
      .sort(
        (a, b) =>
          Number(b.name.toLowerCase().startsWith(query)) -
            Number(a.name.toLowerCase().startsWith(query)) || a.name.localeCompare(b.name),
      )
      .map((command) => ({
        label: '\\' + command.name,
        displayLabel: `\\${command.name}${command.symbol ? '  ' + command.symbol : ''}`,
        detail: command.package || command.category,
        type: 'function',
        section: {
          name: command.category,
          rank: sectionRank(command.category) + (prefixCategories.has(command.category) ? 0 : 50),
        },
        apply: snippet(mathCommandSnippet(command)),
        info: () =>
          commandInfo(command, info.math, [
            ...new Map(
              [...info.macros, ...local]
                .filter((macro) => macro.from < context.pos)
                .map((macro) => [macro.from + macro.raw, macro]),
            ).values(),
          ]),
      }));
    for (const name of mathEnvironments.filter(
      (name) => !query || name.includes(query) || 'begin'.startsWith(query),
    )) {
      const body = /matrix/.test(name)
        ? 'a & b \\\\ c & d'
        : name === 'cases'
          ? 'x & x>0 \\\\ 0 & x\\le 0'
          : 'expression';
      const command: MathCommand = {
        name: `begin{${name}}`,
        description: `${name} environment`,
        category: 'Environments',
        example: `\\begin{${name}}${body}\\end{${name}}`,
      };
      options.push({
        label: `\\begin{${name}}`,
        type: 'type',
        section: { name: 'Environments', rank: 100 },
        detail: 'Math environment',
        apply: snippet(`\\begin\\{${name}\\}\n  \${1:${literal(body)}}\n\\end\\{${name}\\}\${0}`),
        info: () => commandInfo(command, info.math),
      });
    }
    return { from: word.from, options, filter: false };
  };
}
export function mathHover(get: () => MathCompletionContext) {
  return hoverTooltip(
    (view, pos) => {
      const region = mathAt(view.state, pos);
      if (!region) return null;
      const text = view.state.doc.sliceString(region.from, region.to);
      const match = [...text.matchAll(/\\([A-Za-z]+)/g)].find(
        (m) => region.from + m.index! <= pos && region.from + m.index! + m[0].length >= pos,
      );
      if (!match) return null;
      const command = commandsFor(get(), pos).find((c) => c.name === match[1]);
      if (!command) return null;
      return {
        pos: region.from + match.index!,
        end: region.from + match.index! + match[0].length,
        above: true,
        create: () =>
          commandInfo(
            command,
            get().math,
            get().macros.filter((macro) => macro.from < pos),
          ),
      };
    },
    { hoverTime: 350 },
  );
}
export function mathParameterHints(get: () => MathCompletionContext) {
  return showTooltip.compute(['selection', 'doc'], (state) => {
    const pos = state.selection.main.head,
      region = mathAt(state, pos);
    if (!region || !state.selection.main.empty) return null;
    const text = state.doc.sliceString(region.from, Math.min(pos, region.from + 16384));
    const commands = new Map(commandsFor(get(), pos).map((command) => [command.name, command]));
    const stack: ({ command: MathCommand; index: number } | null)[] = [];
    let pending: { command: MathCommand; index: number } | null = null;
    for (const match of text.matchAll(/\\([A-Za-z]+)|\\.|[{}]/g)) {
      if (match[1]) {
        const command = commands.get(match[1]);
        pending = command?.arguments?.length ? { command, index: 0 } : null;
      } else if (match[0] === '{') {
        stack.push(pending);
        pending = null;
      } else if (match[0] === '}') {
        const closed = stack.pop();
        pending =
          closed && closed.index + 1 < (closed.command.arguments?.length || 0)
            ? { command: closed.command, index: closed.index + 1 }
            : null;
      }
    }
    const active = stack.filter(Boolean).at(-1);
    if (!active) return null;
    return {
      pos,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'math-completion-info';
        const signature = document.createElement('code');
        signature.append('\\' + active.command.name);
        active.command.arguments?.forEach((argument, index) => {
          const span = document.createElement(index === active.index ? 'strong' : 'span');
          span.textContent = `{${argument}}`;
          signature.append(span);
        });
        const label = document.createElement('small');
        label.textContent = active.command.description;
        dom.append(signature, label);
        return { dom };
      },
    };
  });
}
export function goToMathDefinition(view: EditorView, macros: MathMacro[]) {
  const pos = view.state.selection.main.head,
    region = mathAt(view.state, pos);
  if (!region) return false;
  const line = view.state.doc.lineAt(pos),
    match = [...line.text.matchAll(/\\([A-Za-z]+)/g)].find(
      (m) => line.from + m.index! <= pos && line.from + m.index! + m[0].length >= pos,
    );
  const macro = match && macros.filter((m) => m.name === match[1] && m.from < pos).at(-1);
  if (!macro) return false;
  view.dispatch({
    selection: { anchor: macro.from },
    effects: EditorView.scrollIntoView(macro.from, { y: 'center' }),
  });
  view.focus();
  return true;
}
