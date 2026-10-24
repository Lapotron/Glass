import {
  pseudocodeLines,
  pseudocodeOptions,
  pseudocodeOperatorSymbol,
  pseudocodeOperatorMath,
} from '../shared/pseudocode.js';
import { escapeHtml } from '../shared/utils.js';
import { codeToolbar } from './code.js';
import { pseudocodeBuiltins } from '../shared/pseudocode-authoring.js';

export async function renderPseudocode(
  source: string,
  meta: string,
  id: string,
  math: (source: string, operator?: boolean) => Promise<string>,
) {
  const options = pseudocodeOptions(meta),
    lines = pseudocodeLines(source);
  const filename = options.title.includes('.')
    ? options.title.replace(/[^\w. -]/g, '_').slice(0, 100)
    : 'algorithm.pseudo';
  const rendered: string[] = [];
  const operators = new Map<string, Promise<string>>();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    let body = '';
    for (const [part, token] of line.parts.entries()) {
      if (token.kind === 'math' && options.style === 'algorithm')
        body += await math(token.text.slice(1, -1));
      else if (token.kind === 'operator') {
        const symbol = pseudocodeOperatorSymbol(token.text);
        const tex = pseudocodeOperatorMath[symbol];
        if (tex && !operators.has(tex)) operators.set(tex, math(tex, true));
        body += `<span class="pseudo-operator" data-pseudo-symbol="${escapeHtml(symbol)}">${tex ? await operators.get(tex)! : escapeHtml(symbol)}</span>`;
      } else if (token.kind === 'keyword') {
        const role = /^(?:procedure|function|algorithm)$/i.test(token.text)
          ? ' pseudo-declaration'
          : /^(?:input|output|require|ensure)$/i.test(token.text)
            ? ' pseudo-label'
            : '';
        body += `<span class="pseudo-keyword${role}">${escapeHtml(token.text)}</span>`;
      } else if (token.kind === 'text') {
        const routine =
          /^[A-Za-z_]\w*$/.test(token.text) &&
          (/^\s*\(/.test(line.parts[part + 1]?.text || '') ||
            pseudocodeBuiltins.some((word) => word.toLowerCase() === token.text.toLowerCase()));
        body += routine
          ? `<span class="pseudo-function">${escapeHtml(token.text)}</span>`
          : escapeHtml(token.text);
      } else body += `<span class="pseudo-${token.kind}">${escapeHtml(token.text)}</span>`;
    }
    rendered.push(
      `<div class="pseudo-line" id="${id}-L${index + 1}">${options.numbers ? `<span class="pseudo-gutter" aria-hidden="true"><a href="#${id}-L${index + 1}" tabindex="-1">${index + 1}</a></span>` : ''}<span class="pseudo-code" data-code-line="${index + 1}">${body || ' '}</span></div>`,
    );
  }
  return `<div class="code-block code-enhanced pseudocode-block pseudo-${options.style}${options.wrap ? ' code-wrapped' : ''}" id="${id}" data-code-filename="${escapeHtml(filename)}" style="--pseudo-digits:${String(lines.length).length}"><div class="code-toolbar">${codeToolbar(options.title, 'pseudocode', options.wrap)}</div><div class="pseudo-lines" role="region" aria-label="Pseudocode" tabindex="0">${rendered.join('')}</div><template data-code-source>${escapeHtml(source)}</template></div>`;
}
