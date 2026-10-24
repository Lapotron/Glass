import { mathjax, mathAdaptor, createMathDocument } from '../../shared/math-renderer.js';
import { mathExtensions, type MathExtension } from '../../shared/math-catalog.js';
import { toolLimits } from '../../shared/tools-catalog.js';
import { STATE } from '@mathjax/src/js/core/MathItem.js';
import { SerializedMmlVisitor } from '@mathjax/src/js/core/MmlTree/SerializedMmlVisitor.js';
import type { MmlNode } from '@mathjax/src/js/core/MmlTree/MmlNode.js';
const fontLoaders = import.meta.glob(
  '/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/*.js',
);
mathjax.asyncLoad = (name: string) => {
  const file = name.split('/').at(-1)!.replace(/\.js$/, '') + '.js';
  const key = Object.keys(fontLoaders).find((key) => key.endsWith('/' + file));
  if (!key) return Promise.reject(new Error('This equation needs an unavailable font.'));
  return fontLoaders[key]();
};
export type MathRequest = {
  id: number;
  source: string;
  display: boolean;
  packages: MathExtension[];
};
export type MathResult = { svg: string; mathml: string };
let queue = Promise.resolve();
export function handleMathRequest(request: MathRequest) {
  if (!request || !Number.isSafeInteger(request.id)) return;
  queue = queue.then(async () => {
    try {
      if (
        typeof request.source !== 'string' ||
        new TextEncoder().encode(request.source).length > toolLimits.mathBytes
      )
        throw new Error('Equations support up to 32 KiB of LaTeX.');
      if (
        !Array.isArray(request.packages) ||
        request.packages.some((p) => !mathExtensions.includes(p))
      )
        throw new Error('Choose supported math packages.');
      const settings = { packages: request.packages },
        limits = { maxBuffer: toolLimits.mathBytes, maxMacros: 1000 };
      const document = createMathDocument(settings, limits);
      const node = await mathjax.handleRetriesFor(() =>
        document.convert(request.source, {
          display: request.display,
          em: 16,
          ex: 8,
          containerWidth: 1000,
        }),
      );
      const html = mathAdaptor.outerHTML(node);
      if (/data-mjx-error|merror|mjx-output-error/.test(html))
        throw new Error('Check the equation syntax and enabled packages.');
      const svgs = mathAdaptor.tags(node, 'svg');
      if (svgs.length !== 1) throw new Error('This equation could not be rendered.');
      const svg = mathAdaptor.outerHTML(svgs[0]);
      const mathDoc = createMathDocument(settings, limits);
      const root = await mathjax.handleRetriesFor(() =>
        mathDoc.convert(request.source, { display: request.display, end: STATE.COMPILED }),
      );
      const mathml = new SerializedMmlVisitor().visitTree(root as MmlNode);
      if (svg.length > 2 * 1024 * 1024) throw new Error('This equation is too large to preview.');
      self.postMessage({ id: request.id, result: { svg, mathml } });
    } catch (error) {
      self.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : 'This equation could not be rendered.',
      });
    }
  });
}
