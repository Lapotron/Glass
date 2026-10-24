import { visit } from 'unist-util-visit';
import { componentByName } from '../shared/markdown-catalog.js';
import {
  analyzeMarkdownTree,
  MarkdownValidationError,
  markdownText,
} from '../shared/markdown-analysis.js';
const alerts = ['note', 'tip', 'important', 'warning', 'caution'];
const containers = [...componentByName.values()]
  .filter((c) => c.kind === 'container')
  .map((c) => c.name);
const inline = [...componentByName.values()].filter((c) => c.kind === 'inline').map((c) => c.name);
const text = (value: string) => ({ type: 'text', value });
export function remarkBlogDirectives() {
  return (tree: any, file: any) => {
    const analysis = analyzeMarkdownTree(tree, String(file.value || ''));
    if (analysis.diagnostics.some((d) => d.severity === 'error'))
      throw new MarkdownValidationError(analysis.diagnostics);
    const labels = new Map(analysis.labels.map((l) => [l.id, l]));
    const keys = new Set<string>();
    visit(tree, (node: any) => {
      if (node.type === 'blockquote') {
        const first = node.children[0]?.children?.[0];
        const match =
          first?.type === 'text' &&
          first.value.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/);
        if (match) {
          first.value = first.value.slice(match[0].length);
          node.data = {
            hName: 'aside',
            hProperties: {
              className: [`md-alert`, `md-${match[1].toLowerCase()}`],
              ariaLabel: match[1].toLowerCase(),
            },
          };
          node.children.unshift({
            type: 'paragraph',
            children: [text(match[1].toLowerCase())],
            data: { hProperties: { className: ['md-component-title'] } },
          });
        }
      }
      if (node.type === 'code' && node.meta) {
        const title = node.meta.match(/title="([^"]{1,200})"/)?.[1];
        const lines = node.meta.match(/\{([\d, -]+)\}/)?.[1];
        node.data = {
          hProperties: {
            dataCodeMeta: node.meta,
            ...(title ? { dataCodeTitle: title } : {}),
            ...(lines ? { dataHighlightLines: lines } : {}),
          },
        };
      }
      if (!['containerDirective', 'leafDirective', 'textDirective'].includes(node.type)) return;
      const name = node.name;
      if (![...containers, ...inline, 'link-card'].includes(name))
        throw new Error(`Unknown Markdown component “${name}”. See the authoring guide.`);
      if (inline.includes(name) && node.type !== 'textDirective')
        throw new Error(`${name} is an inline component.`);
      if (containers.includes(name) && node.type !== 'containerDirective')
        throw new Error(`${name} needs a ::: container.`);
      const attributes = node.attributes || {};
      const label = node.children?.[0]?.data?.directiveLabel ? node.children.shift().children : [];
      const title = label.length
        ? label
        : [text(name === 'details' ? 'More details' : name === 'discussion' ? 'Discussion' : name)];
      let hName = inline.includes(name) ? name : 'div';
      const properties: Record<string, unknown> = { className: [`md-${name}`] };
      const definition = componentByName.get(name)!;
      const reference = labels.get(attributes.id);
      if (attributes.id && definition.attributes.id && name !== 'discussion')
        properties.id = attributes.id;
      const numberedTitle = reference
        ? [text(reference.text + (label.length ? ' · ' : '')), ...label]
        : title;
      if (name === 'ref' || name === 'cite') {
        const target = labels.get(markdownText(node).trim())!;
        node.children = [text(name === 'cite' ? `[${target.number}]` : target.text)];
        node.data = {
          hName: 'a',
          hProperties: {
            href: `#${target.id}`,
            className: [name === 'cite' ? 'md-citation' : 'md-reference'],
          },
        };
        return;
      }
      if (alerts.includes(name)) {
        hName = 'aside';
        properties.className = ['md-alert', `md-${name}`];
        properties.ariaLabel = name;
        node.children.unshift({
          type: 'paragraph',
          children: title,
          data: { hProperties: { className: ['md-component-title'] } },
        });
      } else if (name === 'details') {
        hName = 'details';
        node.children.unshift({ type: 'paragraph', children: title, data: { hName: 'summary' } });
      } else if (name === 'figure' || name === 'table') {
        hName = 'figure';
        if (name === 'figure') {
          if (attributes.width) properties.dataImageWidth = attributes.width;
          if (attributes['max-height']) properties.dataImageMaxHeight = attributes['max-height'];
          if (attributes.align) properties.dataImageAlign = attributes.align;
        }
        if (label.length || reference) {
          const caption = {
            type: 'paragraph',
            children: reference ? numberedTitle : label,
            data: { hName: 'figcaption' },
          };
          if (name === 'table') node.children.unshift(caption);
          else node.children.push(caption);
        }
      } else if (name === 'equation') {
        hName = 'figure';
        if (reference)
          node.children.push({
            type: 'paragraph',
            children: [text(`(${reference.number})`)],
            data: {
              hName: 'span',
              hProperties: { className: ['equation-number'], ariaLabel: reference.text },
            },
          });
        if (label.length)
          node.children.push({ type: 'paragraph', children: label, data: { hName: 'figcaption' } });
      } else if (name === 'mindmap') {
        hName = 'figure';
        const list = node.children[0];
        const walk = (item: any, id: string): any => ({
          id,
          label: markdownText(item.children.find((n: any) => n.type === 'paragraph')).trim(),
          children: item.children
            .filter((n: any) => n.type === 'list')
            .flatMap((list: any) => list.children)
            .map((child: any, index: number) => walk(child, `${id}-${index}`)),
        });
        const root =
          list.children.length === 1
            ? walk(list.children[0], 'n0')
            : {
                id: 'root',
                label: markdownText({ children: title }),
                children: list.children.map((item: any, index: number) => walk(item, `n${index}`)),
              };
        const document = {
          version: 1,
          title: markdownText({ children: title }),
          layout: attributes.layout || 'map',
          root,
        };
        node.children = [
          {
            type: 'paragraph',
            children: title,
            data: { hName: 'figcaption', hProperties: { className: ['md-component-title'] } },
          },
          { type: 'code', lang: 'fieldnotes-mindmap', value: JSON.stringify(document) },
          {
            type: 'paragraph',
            data: { hName: 'details', hProperties: { className: ['mindmap-outline'] } },
            children: [
              {
                type: 'paragraph',
                data: { hName: 'summary' },
                children: [text('Read text outline')],
              },
              list,
            ],
          },
        ];
      } else if (
        [
          'discussion',
          'question',
          'answer',
          'tab',
          'option',
          'comparison',
          'timeline',
          'references',
          'proof',
          'algorithm',
          'reference',
          'theorem',
          'lemma',
          'proposition',
          'corollary',
          'definition',
          'example',
        ].includes(name)
      ) {
        node.children.unshift({
          type: 'paragraph',
          children:
            name === 'reference' ? [text(`[${reference!.number}] `), ...label] : numberedTitle,
          data: {
            hName: 'p',
            hProperties: { className: ['md-component-title'] },
          },
        });
        if (name === 'proof')
          node.children.push({
            type: 'paragraph',
            children: [text('∎')],
            data: { hProperties: { className: ['proof-end'], ariaLabel: 'End of proof' } },
          });
      }
      if (name === 'discussion') {
        const key = attributes.id;
        if (
          attributes.comments &&
          attributes.comments !== 'true' &&
          attributes.comments !== 'false'
        )
          throw new Error('Discussion comments must be true or false.');
        if (attributes.comments === 'true' && !key)
          throw new Error('Reader discussions need a stable #key.');
        if (key) {
          if (!/^[a-zA-Z][\w-]{0,79}$/.test(key) || keys.has(key))
            throw new Error(`Invalid or duplicate discussion key: ${key}`);
          keys.add(key);
          properties.dataDiscussionKey = key;
        }
        properties.dataCommentsRequested = attributes.comments === 'true' ? 'true' : 'false';
      }
      if (name === 'abbr') properties.title = String(attributes.title || '');
      if (name === 'link-card') {
        if (!/^(https:\/\/|\/(?!\/))/.test(attributes.href || ''))
          throw new Error('Link cards need a local or HTTPS href.');
        hName = 'a';
        properties.href = attributes.href;
        node.children = [{ type: 'strong', children: node.children || [] }];
        if (attributes.description)
          node.children.push({ type: 'paragraph', children: [text(attributes.description)] });
      }
      node.data = { hName, hProperties: properties };
    });
  };
}
