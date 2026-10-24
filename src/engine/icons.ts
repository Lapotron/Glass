import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Icon, type IconName } from '../shared/ui.js';

/** Server-only SVG serialization keeps the React server renderer out of widget bundles. */
export function renderIcon(name: IconName, size = 16) {
  return renderToStaticMarkup(createElement(Icon, { name, size }));
}
