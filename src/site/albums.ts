export function startAlbums() {
  const root = document.querySelector<HTMLElement>('[data-album-browser]');
  if (!root) return;
  const tabs = [...root.querySelectorAll<HTMLAnchorElement>('[data-album-tab]')];
  const panels = [...root.querySelectorAll<HTMLElement>('[data-album-panel]')];
  const choose = (view: string, write = false) => {
    const next = view === 'photos' ? 'photos' : 'albums';
    root.dataset.albumView = next;
    tabs.forEach((tab) => {
      const selected = tab.dataset.albumTab === next;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.albumPanel !== next; });
    if (write) {
      const url = new URL(location.href);
      url.searchParams.set('view',next);
      url.hash = '';
      history.pushState(null,'',url);
    }
  };
  const restore = () => choose(new URL(location.href).searchParams.get('view') || (location.hash === '#moments' ? 'photos' : 'albums'));
  root.querySelector('[data-album-tabs]')?.setAttribute('role','tablist');
  tabs.forEach((tab,index) => {
    tab.setAttribute('role','tab');
    tab.id = `album-tab-${tab.dataset.albumTab}`;
    const panel = panels.find((item) => item.dataset.albumPanel === tab.dataset.albumTab)!;
    tab.setAttribute('aria-controls',panel.id);
    panel.setAttribute('role','tabpanel');
    panel.setAttribute('aria-labelledby',tab.id);
    tab.addEventListener('click',(event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault(); choose(tab.dataset.albumTab!,true);
    });
    tab.addEventListener('keydown',(event) => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      choose(tabs[next].dataset.albumTab!,true); tabs[next].focus();
    });
  });
  restore();
  addEventListener('popstate',restore);
  addEventListener('hashchange',restore);
}
