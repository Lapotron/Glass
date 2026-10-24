/** Compiler-only module. Ordinary readers must never import this graph. */
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js';
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js';
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import '@mathjax/src/js/input/tex/amscd/AmsCdConfiguration.js';
import '@mathjax/src/js/input/tex/cases/CasesConfiguration.js';
import '@mathjax/src/js/input/tex/centernot/CenternotConfiguration.js';
import '@mathjax/src/js/input/tex/extpfeil/ExtpfeilConfiguration.js';
import '@mathjax/src/js/input/tex/upgreek/UpgreekConfiguration.js';
import '@mathjax/src/js/input/tex/gensymb/GensymbConfiguration.js';
import '@mathjax/src/js/input/tex/textcomp/TextcompConfiguration.js';
import '@mathjax/src/js/input/tex/units/UnitsConfiguration.js';
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js';
import '@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js';
import { MathJaxMhchemFontExtension } from '@mathjax/mathjax-mhchem-font-extension/mjs/svg.js';
import { effectiveMathPackages, type MathSettings } from './math-catalog.js';
export { mathjax };
export const mathAdaptor = liteAdaptor();
RegisterHTMLHandler(mathAdaptor);
export function createMathDocument(
  settings?: MathSettings,
  limits: { maxBuffer?: number; maxMacros?: number } = {},
) {
  const output = new SVG({ fontCache: 'none' });
  if (settings?.packages.includes('mhchem')) output.font.addExtension(MathJaxMhchemFontExtension);
  return mathjax.document('', {
    InputJax: new TeX({ packages: effectiveMathPackages(settings), ...limits }),
    OutputJax: output,
  });
}
