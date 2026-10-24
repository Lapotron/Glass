/** Local Studio can serve dist paths; hosted Studio sends public links to its separate reader. */
let publicOrigin = '';
let installed = false;
export function cloudReaderLinks(origin: string) {
  publicOrigin = new URL(origin).origin;
  const update = (anchor: HTMLAnchorElement) => {
    const path = anchor.getAttribute('href');
    if (
      !path?.startsWith('/') ||
      path.startsWith('//') ||
      /^\/(?:studio|api|media|m|assets|authoring|cloud-compiler|cdn-cgi|preview)(?:\/|$)/.test(path)
    )
      return;
    anchor.href = new URL(path, publicOrigin).href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  };
  if (installed) return;
  installed = true;
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(update);
  new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === 'attributes' && change.target instanceof HTMLAnchorElement)
        update(change.target);
      for (const node of change.addedNodes)
        if (node instanceof Element) {
          if (node instanceof HTMLAnchorElement) update(node);
          node.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(update);
        }
    }
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href'],
  });
}
