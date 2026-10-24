/** Build-only syntax rendering. No highlighter or Expressive Code engine ships to readers. */
import { ExpressiveCode, loadShikiTheme } from 'expressive-code';
import { toHtml } from 'expressive-code/hast';
import { pluginLineNumbers } from '@expressive-code/plugin-line-numbers';
import { pluginCollapsibleSections } from '@expressive-code/plugin-collapsible-sections';
import { visit } from 'unist-util-visit';
import type { Element } from 'hast';
import { renderIcon } from './icons.js';
import { escapeHtml } from '../shared/utils.js';

const labelAttrs = (label: string, title = label) => `aria-label="${escapeHtml(label)}" title="${escapeHtml(title)}" data-ui-attrs="${escapeHtml(JSON.stringify({'aria-label':label,title}))}"`;

export function codeToolbar(title:string,language:string,wrapped=false) {
  return `<span class="code-identity">${renderIcon('FileText',13)}<span class="code-filename" title="${escapeHtml(title)}">${escapeHtml(title)}</span>${title!==language?`<span class="code-language">${escapeHtml(language)}</span>`:''}</span><div class="code-actions" role="group" ${labelAttrs('Code block controls')}><button type="button" data-code-wrap ${labelAttrs('Wrap','Wrap long lines')} aria-pressed="${wrapped}">${renderIcon('WrapText',13)}<span data-ui="Wrap">Wrap</span></button><button type="button" data-code-download ${labelAttrs('Download','Download source')}>${renderIcon('Download',13)}<span data-ui="Download">Download</span></button><button type="button" class="copy-code" ${labelAttrs('Copy code')}>${renderIcon('Copy',13)}<span data-code-copy-label data-ui="Copy">Copy</span></button></div>`;
}

const engine = Promise.all([loadShikiTheme('github-light'), loadShikiTheme('github-dark')]).then(
  (themes) =>
    new ExpressiveCode({
      themes,
      useDarkModeMediaQuery: false,
      themeCssSelector: (theme) => `[data-theme="${theme.type}"]`,
      minSyntaxHighlightingColorContrast: 5.5,
      frames: { showCopyToClipboardButton: false },
      plugins: [pluginLineNumbers(), pluginCollapsibleSections()],
      defaultProps: { showLineNumbers: true, collapseStyle: 'collapsible-start' },
      styleOverrides: {
        borderRadius: '16px',
        codeFontSize: '.86rem',
        codeLineHeight: '1.65',
        codeFontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
      },
    }),
);
export async function codeStyles() {
  const ec = await engine;
  return `${await ec.getBaseStyles()}\n${await ec.getThemeStyles()}`;
}
export async function renderCode(code: string, language: string, meta: string, id: string) {
  const ec = await engine;
  let result;
  try {
    result = await ec.render({ code, language, meta });
  } catch {
    result = await ec.render({ code, language: 'text', meta });
  }
  let line = 0,
    wrapped = false;
  visit(result.renderedGroupAst, 'element', (node: Element, _index, parent) => {
    const classes = node.properties.className as string[] | undefined;
    if (node.tagName === 'figure' && classes?.includes('frame') && classes.includes('has-title'))
      node.properties.className = classes.filter((name) => name !== 'has-title');
    if (
      node.tagName === 'pre' &&
      (node.properties.className as string[] | undefined)?.includes('wrap')
    )
      wrapped = true;
    if (parent?.type === 'element' && parent.tagName === 'summary') return;
    if (!(node.properties.className as string[] | undefined)?.includes('ec-line')) return;
    line++;
    node.properties.id = `${id}-L${line}`;
    const content = node.children.find(
      (child): child is Element =>
        child.type === 'element' &&
        !!(child.properties.className as string[] | undefined)?.includes('code'),
    );
    if (content) content.properties.dataCodeLine = line;
    // A separate gutter link does not become part of annotation hashes or copied code.
    const gutter = node.children.find(
      (child): child is Element =>
        child.type === 'element' &&
        !!(child.properties.className as string[] | undefined)?.includes('gutter'),
    );
    if (gutter)
      gutter.children.push({
        type: 'element',
        tagName: 'a',
        properties: {
          href: `#${id}-L${line}`,
          className: ['code-line-link'],
          ariaLabel: `Link to code line ${line}`,
          tabIndex: -1,
        },
        children: [],
      });
  });
  const title = result.renderedGroupContents[0]?.codeBlock.props.title || language;
  const filename = title.includes('.')
    ? title.replace(/[^\w. -]/g, '_').slice(0, 100)
    : `snippet.${({ javascript: 'js', typescript: 'ts', python: 'py', bash: 'sh', text: 'txt' } as Record<string, string>)[language] || language.replace(/[^\w]/g, '') || 'txt'}`;
  const controls = codeToolbar(title, language, wrapped);
  let html = toHtml(result.renderedGroupAst);
  // Integrate with the file/terminal frame instead of stacking a second toolbar above its caption.
  if (/<figcaption class="header"[^>]*>/.test(html))
    html = html.replace(
      /<figcaption class="header"[^>]*>[\s\S]*?<\/figcaption>/,
      `<figcaption class="header code-toolbar">${controls}</figcaption>`,
    );
  else html = `<div class="code-toolbar">${controls}</div>${html}`;
  return `<div class="code-block code-enhanced${wrapped ? ' code-wrapped' : ''}" id="${id}" data-code-filename="${escapeHtml(filename)}">${[...result.styles].map((css) => `<style>${css}</style>`).join('')}${html}</div>`;
}
