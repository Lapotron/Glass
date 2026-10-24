import { renderMarkdown } from '../../engine/markdown.js';
export const markdownCompiler = async () => ({ render: renderMarkdown, prune: async () => {} });
