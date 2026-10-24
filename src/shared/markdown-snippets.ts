import { markdownPresets } from './markdown-presets.js';
import { markdownCatalog } from './markdown-catalog.js';
export const markdownSnippets = [
  ...markdownPresets,
  ...markdownCatalog
    .filter(
      (s) =>
        ['Academic', 'Visual'].includes(s.group) &&
        !['figure', 'gallery', 'reference', 'option'].includes(s.name),
    )
    .map((s) => ({
      type: s.name,
      label: s.name === 'equation' ? 'Numbered equation' : s.label,
      icon: s.icon,
      value: s.example,
    })),
];
export function instantiateSnippet(value: string) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const ids = new Map(
    [...value.matchAll(/\{#([A-Za-z][\w-]*)/g)].map((m) => [m[1], `${m[1]}-${suffix}`]),
  );
  let result = value.replaceAll('SECTION_KEY', `section-${suffix}`);
  result = result.replace(/#([A-Za-z][\w-]*)/g, (match, label: string) =>
    ids.has(label) ? '#' + ids.get(label) : match,
  );
  for (const [old, next] of ids)
    result = result
      .replaceAll(`:ref[${old}]`, `:ref[${next}]`)
      .replaceAll(`:cite[${old}]`, `:cite[${next}]`);
  return result;
}
