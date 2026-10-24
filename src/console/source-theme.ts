import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { inlineHighlightTag } from './source-language.js';
import { pseudocodeTags } from './pseudocode-language.js';
// Follow the Studio's live foreground roles instead of CodeMirror's fixed light palette.
export const sourceHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    {
      tag: inlineHighlightTag,
      backgroundColor: 'color-mix(in srgb,var(--accent) 20%,transparent)',
      borderRadius: '3px',
      color: 'var(--text)',
    },
    { tag: tags.heading, color: 'var(--heading)', fontWeight: '600' },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: [tags.link, tags.url], color: 'var(--link-text)', textDecoration: 'underline' },
    { tag: [tags.keyword, tags.typeName, tags.attributeName], color: 'var(--accent-text)' },
    { tag: [tags.string, tags.regexp], color: 'var(--success)' },
    { tag: [tags.number, tags.bool, tags.atom], color: 'var(--warning)' },
    { tag: [tags.comment, tags.meta], color: 'var(--faint)' },
    { tag: [tags.operator, tags.punctuation, tags.processingInstruction], color: 'var(--muted)' },
    { tag: tags.monospace, color: 'var(--text)' },
    { tag: tags.invalid, color: 'var(--danger)', textDecoration: 'underline wavy' },
    { tag: pseudocodeTags.declaration, color: 'var(--heading)', fontWeight: '650' },
    { tag: pseudocodeTags.control, color: 'var(--accent-text)', fontWeight: '600' },
    { tag: pseudocodeTags.function, color: 'var(--link-text)' },
    { tag: pseudocodeTags.variable, color: 'var(--text)' },
    { tag: pseudocodeTags.constant, color: 'var(--warning)' },
    { tag: pseudocodeTags.operator, color: 'var(--accent-text)' },
    { tag: pseudocodeTags.math, color: 'var(--link-text)', fontStyle: 'italic' },
    { tag: pseudocodeTags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  ]),
);
