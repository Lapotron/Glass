import { unified } from 'unified';
import { countWork } from './work-cache.js';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import { remarkDefinitionList, defListHastHandlers } from 'remark-definition-list';
import { remarkBlogDirectives } from './directives.js';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { visit, SKIP } from 'unist-util-visit';
import { renderCode } from './code.js';
import { renderPseudocode } from './pseudocode.js';
import { pseudocodeLanguages } from '../shared/pseudocode.js';
import { remarkInlineHighlight } from '../shared/inline-highlight.js';
import { mathjax, mathAdaptor as adaptor, createMathDocument } from '../shared/math-renderer.js';
import { STATE } from '@mathjax/src/js/core/MathItem.js';
import { effectiveMathPackages, type MathSettings } from '../shared/math-catalog.js';
import { parseMarkdown } from '../shared/markdown-analysis.js';
import type { Root, Element } from 'hast';
import { escapeHtml, headingSlug, imageSet } from '../shared/utils.js';
import { renderInteractive } from '../shared/interactives.js';
import { renderIcon } from './icons.js';
import { createDiagramRenderer, type DiagramRenderer } from './diagrams.js';
import type { DiagramPresentation } from '../shared/diagram-presentation.js';
import { renderChartSvg } from './charts.js';
import { renderMindmap } from './mindmap.js';
import { digest } from './store.js';
import { encodeContact, contactLabel } from '../shared/contact.js';
import { attachmentFile } from '../shared/attachments.js';
import { imageLayout } from '../shared/image-layout.js';
import {
  mathPreviewLimits,
  type MathPreviewExpression,
  type MathPreviewResult,
} from '../shared/math-preview.js';

// Direct MathJax modules need an explicit local font loader, including for rare SVG glyphs.
mathjax.asyncLoad ||= (name: string) => {
  const file = name.split('/').at(-1)!.replace(/\.js$/, '');
  if (!/^[A-Za-z0-9_-]+$/.test(file))
    return Promise.reject(new Error('Unsupported math font part.'));
  return import(`@mathjax/mathjax-newcm-font/mjs/svg/dynamic/${file}.js`);
};

async function renderMath(
  source: string,
  display: boolean,
  mathDocument: ReturnType<typeof createMathDocument>,
) {
  const node = await mathjax.handleRetriesFor(() =>
    mathDocument.convert(source, { display, em: 16, ex: 8, containerWidth: 1100 }),
  );
  // The surrounding math role owns the accessible TeX label; hide the nested drawing to avoid duplicate announcements.
  for (const svg of adaptor.tags(node, 'svg')) {
    adaptor.setAttribute(svg, 'aria-hidden', 'true');
    adaptor.setAttribute(svg, 'focusable', 'false');
  }
  let html = adaptor.outerHTML(node);
  if (/data-mjx-error|merror/.test(html))
    throw new Error(`Invalid equation: ${source.slice(0, 120)}`);
  html = `<${display ? 'div' : 'span'} class="math-${display ? 'display' : 'inline'}"${display ? ' tabindex="0"' : ''} role="math" aria-label="${escapeHtml(source)}">${html}</${display ? 'div' : 'span'}>`;
  return html;
}
/** Private Studio batch: macros have document scope, and never cross requests. */
export async function renderMathPreviews(
  expressions: MathPreviewExpression[],
  settings?: MathSettings,
): Promise<MathPreviewResult[]> {
  if (
    expressions.length > mathPreviewLimits.count ||
    expressions.some((item) => item.source.length > mathPreviewLimits.expression) ||
    Buffer.byteLength(expressions.map((item) => item.source).join(''), 'utf8') >
      mathPreviewLimits.inputBytes
  )
    throw new Error('Math previews support up to 200 expressions and 128 KiB of TeX per document.');
  const document = createMathDocument(settings),
    results: MathPreviewResult[] = [];
  let bytes = 0;
  for (const expression of expressions) {
    if (bytes > mathPreviewLimits.outputBytes) {
      results.push({
        error: 'This document reached the math preview size limit. TeX source is unchanged.',
      });
      continue;
    }
    try {
      const html = await renderMath(expression.source, expression.display, document);
      // A macro-only inline expression has no drawing; do not add an empty source chip.
      const output =
        !expression.display &&
        !/<(?:path|rect|line|polyline|polygon|circle|ellipse|text|image|use)\b/.test(html)
          ? ''
          : html;
      bytes += Buffer.byteLength(output, 'utf8');
      if (bytes > mathPreviewLimits.outputBytes)
        results.push({
          error: 'This document reached the math preview size limit. TeX source is unchanged.',
        });
      else results.push({ html: output });
    } catch (error) {
      results.push({
        error: error instanceof Error ? error.message : 'This equation could not be rendered.',
      });
    }
  }
  return results;
}
const equationCache = new Map<string, { result: MathPreviewResult; bytes: number }>();
let equationCacheBytes = 0;
/** Render only requested equations, compiling the preceding TeX without SVG output. */
export async function renderSourceMathPreviews(
  source: string,
  ranges: { from: number; to: number }[],
  settings?: MathSettings,
): Promise<MathPreviewResult[]> {
  if (Buffer.byteLength(source) > 2 * 1024 * 1024 || ranges.length > mathPreviewLimits.count)
    throw new Error('Math preview source or batch is too large.');
  const expressions: (MathPreviewExpression & { from: number; to: number; key: string })[] = [];
  let context = effectiveMathPackages(settings).join(',');
  visit(parseMarkdown(source), (node: any) => {
    if (node.type !== 'math' && node.type !== 'inlineMath') return;
    const display = node.type === 'math';
    context = digest(context + JSON.stringify([node.value, display]));
    expressions.push({
      source: node.value,
      display,
      from: node.position.start.offset,
      to: node.position.end.offset,
      key: context,
    });
  });
  const requested = ranges.map((range) =>
    expressions.findIndex((item) => item.from === range.from && item.to === range.to),
  );
  if (requested.some((index) => index < 0))
    throw new Error('The equation changed. Retry its preview.');
  if (requested.every((index) => equationCache.has(expressions[index].key)))
    return requested.map((index) => equationCache.get(expressions[index].key)!.result);
  const document = createMathDocument(settings),
    wanted = new Set(requested),
    results = new Map<number, MathPreviewResult>();
  let outputBytes = 0;
  for (let index = 0; index <= Math.max(-1, ...requested); index++) {
    const expression = expressions[index];
    const cached = equationCache.get(expression.key);
    try {
      if (expression.source.length > mathPreviewLimits.expression)
        throw new Error('This expression exceeds the TeX preview limit.');
      let result: MathPreviewResult | undefined;
      if (wanted.has(index) && !cached) {
        const html = await renderMath(expression.source, expression.display, document);
        result = {
          html: !expression.display && !/<(?:path|rect|line|text|use)\b/.test(html) ? '' : html,
        };
        const bytes = Buffer.byteLength(result.html!);
        if (bytes > mathPreviewLimits.outputBytes)
          throw new Error('Equation drawing exceeds the preview limit.');
        equationCache.set(expression.key, { result, bytes });
        equationCacheBytes += bytes;
        while (equationCache.size > 512 || equationCacheBytes > 8 * 1024 * 1024) {
          const first = equationCache.keys().next().value!;
          equationCacheBytes -= equationCache.get(first)!.bytes;
          equationCache.delete(first);
        }
      } else {
        await mathjax.handleRetriesFor(() =>
          document.convert(expression.source, { display: expression.display, end: STATE.COMPILED }),
        );
        result = cached?.result;
      }
      if (wanted.has(index)) {
        outputBytes += Buffer.byteLength(result?.html || '');
        results.set(
          index,
          outputBytes > mathPreviewLimits.outputBytes
            ? { error: 'Math preview output limit reached.' }
            : result!,
        );
      }
    } catch (error) {
      if (wanted.has(index)) results.set(index, { error: (error as Error).message });
    }
    if (index % 32 === 31) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return requested.map((index) => results.get(index)!);
}
function textOf(node: any): string {
  return node.type === 'text' ? node.value : (node.children || []).map(textOf).join('');
}
export type MarkdownResult = {
  html: string;
  headings: { id: string; text: string; level: number }[];
  media: string[];
  words: number;
  titleAnchor?: string;
  titleRange?: [number, number];
};
let documentSequence = 0;
export async function renderMarkdown(
  source: string,
  context: {
    entryId?: string;
    comments?: boolean;
    preview?: boolean;
    aboutName?: string;
    documentId?: string;
    diagrams?: DiagramRenderer;
    diagramPresentation?: DiagramPresentation;
    chartCacheDir?: string;
    chartFontScale?: number;
    protectEmailLinks?: boolean;
    mathContext?: MathPreviewExpression[];
    math?: MathSettings;
  } = {},
): Promise<MarkdownResult> {
  countWork('markdown.render');
  const diagrams = context.diagrams || createDiagramRenderer();
  const documentId = digest(
    (context.documentId || context.entryId || `markdown-${++documentSequence}`) + source,
  ).slice(0, 16);
  let diagramSequence = 0;
  // Macro definitions may span expressions in one document, but never leak to another post or preview.
  let mathDocument: ReturnType<typeof createMathDocument> | undefined;
  let pseudocodeOperatorDocument: ReturnType<typeof createMathDocument> | undefined;
  if (context.mathContext?.length) {
    mathDocument = createMathDocument(context.math);
    for (const expression of context.mathContext) {
      try {
        await mathjax.handleRetriesFor(() =>
          mathDocument!.convert(expression.source, {
            display: expression.display,
            end: STATE.COMPILED,
          }),
        );
      } catch {
        /* Invalid preceding math does not prevent a later component preview. */
      }
    }
  }
  const headings: MarkdownResult['headings'] = [];
  const media = new Set<string>();
  const slugs = new Map<string, number>();
  let widgetSequence = 0;
  const discussionKeys = new Set<string>();
  let titleAnchor: string | undefined;
  let titleRange: [number, number] | undefined;
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkInlineHighlight)
    .use(remarkDirective)
    .use(remarkDefinitionList)
    .use(remarkBlogDirectives)
    // Sanitization adds the one shared prefix to IDs and their fragment references.
    .use(remarkRehype, {
      allowDangerousHtml: true,
      clobberPrefix: '',
      handlers: defListHastHandlers,
    })
    .use(rehypeRaw)
    .use(rehypeSanitize, {
      ...defaultSchema,
      tagNames: [
        ...(defaultSchema.tagNames || []),
        'aside',
        'figure',
        'figcaption',
        'mark',
        'abbr',
        'kbd',
        'sub',
        'sup',
      ],
      attributes: {
        ...defaultSchema.attributes,
        '*': [
          ...(defaultSchema.attributes?.['*'] || []),
          'className',
          'ariaLabel',
          'dataDiscussionKey',
          'dataCommentsRequested',
        ],
        a: [
          ...(defaultSchema.attributes?.a || []).filter(
            (a) => !(Array.isArray(a) && a[0] === 'className'),
          ),
          ['className', 'md-link-card', 'md-reference', 'md-citation', 'data-footnote-backref'],
        ],
        figure: [
          ...(defaultSchema.attributes?.figure || []),
          'dataImageWidth',
          'dataImageMaxHeight',
          'dataImageAlign',
        ],
        code: [
          ['className', /^language-/, 'math-inline', 'math-display'],
          'dataCodeTitle',
          'dataCodeMeta',
          'dataHighlightLines',
        ],
      },
    })
    .use(() => async (tree: Root) => {
      if (context.aboutName) {
        const first = tree.children.find((node) => node.type === 'element');
        if (
          first?.type === 'element' &&
          first.tagName === 'h1' &&
          textOf(first).trim() === context.aboutName.trim()
        ) {
          titleAnchor = headingSlug(textOf(first));
          slugs.set(titleAnchor, 1);
          if (first.position?.start.offset !== undefined && first.position.end.offset !== undefined)
            titleRange = [first.position.start.offset, first.position.end.offset];
          tree.children.splice(tree.children.indexOf(first), 1);
        }
      }
      const tasks: (() => Promise<void>)[] = [];
      const addTask = (node: Element, run: () => Promise<void>) =>
        tasks.push(async () => {
          try {
            await run();
          } catch (error) {
            if (error instanceof Error) Object.assign(error, { sourcePosition: node.position });
            throw error;
          }
        });
      const processed = new WeakSet<Element>();
      visit(tree, 'element', (node: Element, index, parent) => {
        if (
          /^h[1-6]$/.test(node.tagName) &&
          !(node.properties.className as string[] | undefined)?.includes('sr-only')
        ) {
          if (context.aboutName) node.tagName = `h${Math.min(6, Number(node.tagName[1]) + 1)}`;
          const text = textOf(node);
          const base = headingSlug(text);
          const count = slugs.get(base) || 0;
          slugs.set(base, count + 1);
          const id = `${base}${count ? `-${count + 1}` : ''}`;
          node.properties.id = id;
          headings.push({ id, text, level: Number(node.tagName[1]) });
        }
        const componentClasses = (node.properties.className || []) as string[];
        if (node.tagName === 'figure' && componentClasses.includes('md-figure')) {
          const layout = imageLayout({
            width: node.properties.dataImageWidth,
            'max-height': node.properties.dataImageMaxHeight,
            align: node.properties.dataImageAlign,
          });
          const styles: string[] = [];
          if (layout.width) styles.push(`width:${layout.width};max-width:100%`);
          if (layout.maxHeight) styles.push(`--figure-max-height:${layout.maxHeight}`);
          if (styles.length) node.properties.style = styles.join(';');
          if (layout.width || layout.maxHeight || layout.align)
            node.properties.dataImageAlign = layout.align || 'center';
        }
        if (componentClasses.includes('md-discussion')) {
          const key = String(node.properties.dataDiscussionKey || '');
          if (key) {
            if (!/^[a-zA-Z][\w-]{0,79}$/.test(key) || discussionKeys.has(key))
              throw new Error(`Invalid or duplicate discussion key: ${key}`);
            discussionKeys.add(key);
            node.properties.id = `discussion-${key}`;
          }
          if (node.properties.dataCommentsRequested === 'true' && !key)
            throw new Error('Reader discussions need a stable #key.');
          if (node.properties.dataCommentsRequested === 'true') {
            const active = context.comments && context.entryId && !context.preview;
            node.children.push({
              type: 'raw',
              value: active
                ? `<details class="section-thread" id="conversation-${escapeHtml(key)}" data-section-thread="${escapeHtml(key)}" data-comment-term="entry/${escapeHtml(context.entryId!)}/section/${escapeHtml(key)}" data-discussion-state="idle"><summary>${renderIcon('MessageCircle', 15)} Join this conversation</summary><p class="discussion-metadata" data-discussion-meta hidden></p><div class="discussion-actions"><a class="text-link" data-comment-link>Open on GitHub</a><button type="button" class="text-link discussion-copy" data-copy-discussion>Copy conversation link</button></div><p class="help discussion-status" role="status" data-comments-status>Open this section to connect to GitHub.</p><div data-section-thread-host></div></details>`
                : `<p class="discussion-unavailable">${context.preview ? 'Reader conversation appears here after publishing.' : 'Reader conversation is not enabled.'}</p>`,
            } as any);
          }
          delete node.properties.dataCommentsRequested;
        }
        if (node.tagName === 'img') {
          const src = String(node.properties.src || '');
          if (src.startsWith('/media/')) media.add(src);
          node.properties.loading = 'lazy';
          node.properties.decoding = 'async';
          const srcSet = imageSet(src);
          if (srcSet) {
            node.properties.srcSet = srcSet;
            node.properties.sizes = '(max-width: 760px) 100vw, 740px';
          }
        }
        if (
          node.tagName === 'a' &&
          typeof node.properties.href === 'string' &&
          node.properties.href.startsWith('/media/')
        ) {
          media.add(node.properties.href);
          if (attachmentFile(node.properties.href))
            node.properties.className = [
              ...((node.properties.className || []) as string[]),
              'attachment-link',
            ];
        }
        if (node.tagName === 'input' && node.properties.type === 'checkbox' && parent) {
          node.properties.ariaLabel = textOf(parent).trim() || 'Checklist item';
        }
        if (node.tagName !== 'code' || !parent || index === undefined) return;
        if (processed.has(node)) return;
        processed.add(node);
        const classes = (node.properties.className || []) as string[];
        const value = textOf(node).replace(/\n$/, '');
        const display = classes.includes('math-display');
        if (classes.includes('math-inline') || display) {
          const container = parent.type === 'element' && parent.tagName === 'pre' ? parent : null;
          addTask(node, async () => {
            const html = await renderMath(
              value,
              display,
              (mathDocument ??= createMathDocument(context.math)),
            );
            if (container) {
              container.tagName = 'div';
              container.properties = {};
              container.children = [{ type: 'raw', value: html } as any];
            } else parent.children[index] = { type: 'raw', value: html } as any;
          });
          return;
        }
        if (parent.type !== 'element' || parent.tagName !== 'pre') return;
        const language = classes.find((v) => v.startsWith('language-'))?.slice(9) || 'text';
        if (language === 'interactive') {
          const config = JSON.parse(value);
          if (config.type === 'image-compare') {
            media.add(config.before);
            media.add(config.after);
          }
          parent.tagName = 'div';
          parent.properties = { className: ['interactive-block'] };
          const widgetId = `article-widget-${documentId}-${++widgetSequence}`;
          if (config.type === 'chart') {
            addTask(node, async () => {
              const svg = await renderChartSvg(
                config,
                widgetId,
                context.chartCacheDir,
                context.chartFontScale,
              );
              parent.children = [
                { type: 'raw', value: renderInteractive(config, renderIcon, widgetId, svg) } as any,
              ];
            });
            return;
          }
          parent.children = [
            {
              type: 'raw',
              value: renderInteractive(config, renderIcon, widgetId),
            } as any,
          ];
        } else if (language === 'mermaid' || language === 'fieldnotes-mindmap') {
          const mindmap = language === 'fieldnotes-mindmap';
          parent.tagName = 'figure';
          parent.properties = mindmap
            ? { className: ['mindmap-stage'] }
            : { className: ['diagram'], 'data-mermaid': '' };
          const namespace = `diagram-${documentId}-${++diagramSequence}`;
          addTask(node, async () => {
            if (mindmap) {
              parent.children = [
                { type: 'raw', value: renderMindmap(JSON.parse(value), namespace) } as any,
              ];
              return;
            }
            const svg = await diagrams.render(value, namespace, context.diagramPresentation);
            const sourceHtml = await renderCode(
              value,
              'mermaid',
              'title="diagram.mmd"',
              namespace + '-source',
            );
            parent.properties.id = namespace;
            parent.children = [
              {
                type: 'raw',
                value: `<div class="mermaid-canvas"><div data-diagram-variant="light">${svg.light}</div><div data-diagram-variant="dark">${svg.dark}</div></div>${svg.title ? `<figcaption>${escapeHtml(svg.title)}</figcaption>` : ''}<details class="diagram-source"><summary>View Mermaid source</summary>${sourceHtml}</details>`,
              } as any,
            ];
          });
        } else if (pseudocodeLanguages.includes(language)) {
          addTask(node, async () => {
            const id = `code-${documentId}-${++widgetSequence}`;
            const html = await renderPseudocode(
              value,
              String(node.properties.dataCodeMeta || ''),
              id,
              (source, operator) =>
                renderMath(
                  source,
                  false,
                  operator
                    ? (pseudocodeOperatorDocument ??= createMathDocument())
                    : (mathDocument ??= createMathDocument(context.math)),
                ),
            );
            parent.tagName = 'div';
            parent.properties = {};
            parent.children = [{ type: 'raw', value: html } as any];
          });
        } else {
          addTask(node, async () => {
            const meta = String(
              node.properties.dataCodeMeta ||
                (node.properties.dataCodeTitle ? `title="${node.properties.dataCodeTitle}" ` : '') +
                  (node.properties.dataHighlightLines
                    ? `{${node.properties.dataHighlightLines}}`
                    : ''),
            );
            const html = await renderCode(
              value,
              language,
              meta,
              `code-${documentId}-${++widgetSequence}`,
            );
            parent.tagName = 'div';
            parent.properties = {};
            parent.children = [{ type: 'raw', value: html } as any];
          });
        }
      });
      // MathJax keeps per-document state; serial rendering also preserves predictable SVG identifiers.
      for (const task of tasks) await task();
      visit(tree, 'element', (node: Element, index, parent) => {
        if (node.tagName !== 'table' || !parent || index === undefined) return;
        if (
          parent.type === 'element' &&
          ((parent.properties.className as string[]) || []).includes('prose-table-scroll')
        )
          return;
        visit(node, 'element', (cell: Element) => {
          if (cell.tagName === 'th') cell.properties.scope = 'col';
        });
        parent.children[index] = {
          type: 'element',
          tagName: 'div',
          properties: {
            className: ['prose-table-scroll'],
            tabIndex: 0,
            role: 'region',
            ariaLabel: 'Scrollable data table',
          },
          children: [node],
          position: node.position,
        };
        return SKIP;
      });
      const existingIds = new Set<string>();
      if (titleAnchor) existingIds.add(titleAnchor);
      visit(tree, 'element', (node: Element) => {
        if (
          context.preview &&
          /^(?:h[1-6]|p|pre|div|figure|blockquote|ul|ol|li|table|dl|details|aside)$/.test(
            node.tagName,
          ) &&
          node.position?.start.offset !== undefined &&
          node.position.end.offset !== undefined
        ) {
          node.properties.dataSourceStart = node.position.start.offset;
          node.properties.dataSourceEnd = node.position.end.offset;
        }
        if (typeof node.properties.id === 'string') existingIds.add(node.properties.id);
      });
      visit(tree, 'element', (node: Element) => {
        if (
          context.protectEmailLinks !== false &&
          node.tagName === 'a' &&
          typeof node.properties.href === 'string' &&
          /^mailto:/i.test(node.properties.href) &&
          (!node.position ||
            /^(?:\[|<)/.test(source.slice(node.position.start.offset, node.position.end.offset)))
        ) {
          const label = contactLabel(textOf(node) || 'Email');
          const token = encodeContact(node.properties.href);
          node.tagName = 'span';
          node.properties = { className: ['protected-email-wrap'] };
          node.children = [
            {
              type: 'element',
              tagName: 'button',
              properties: {
                type: 'button',
                className: ['protected-email', 'text-link'],
                dataEmailToken: token,
                ariaHasPopup: 'dialog',
                disabled: true,
                title: 'Reveal email address',
              },
              children: [{ type: 'text', value: label }],
            },
            {
              type: 'element',
              tagName: 'noscript',
              properties: {},
              children: [{ type: 'text', value: 'Enable JavaScript to reveal email.' }],
            },
          ];
        }
        // rehype-sanitize prefixes IDs to prevent DOM clobbering. Keep local references in sync.
        if (
          node.tagName === 'a' &&
          typeof node.properties.href === 'string' &&
          node.properties.href.startsWith('#')
        ) {
          const id = node.properties.href.slice(1);
          if (!existingIds.has(id) && existingIds.has(`user-content-${id}`))
            node.properties.href = `#user-content-${id}`;
        }
        if (Array.isArray(node.properties.ariaDescribedBy)) {
          node.properties.ariaDescribedBy = node.properties.ariaDescribedBy.map((id) =>
            !existingIds.has(String(id)) && existingIds.has(`user-content-${id}`)
              ? `user-content-${id}`
              : id,
          );
        }
        if (
          node.tagName === 'a' &&
          typeof node.properties.href === 'string' &&
          node.properties.href.startsWith('https://')
        )
          node.properties.rel = ['noopener', 'noreferrer'];
      });
    })
    .use(rehypeStringify, { allowDangerousHtml: true });
  let html: string;
  try {
    html = String(await processor.process(source));
  } finally {
    if (!context.diagrams) await diagrams.close();
  }
  return {
    html,
    headings,
    titleAnchor,
    titleRange,
    media: [...media],
    words: source.match(/[\p{L}\p{N}]+|[\p{Script=Han}]/gu)?.length || 0,
  };
}
