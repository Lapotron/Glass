import { t } from '../shared/i18n.js';
let watchingHash = false;
export function startCodeTools(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('.code-enhanced').forEach((block) => {
    if (block.dataset.codeReady) return;
    block.dataset.codeReady = 'true';
    const source = () => block.querySelector<HTMLTemplateElement>('template[data-code-source]')?.content.textContent ??
      [...block.querySelectorAll<HTMLElement>('[data-code-line]')]
        .map((line) => line.textContent || '')
        .join('\n');
    block.querySelector('[data-code-wrap]')?.addEventListener('click', (event) => {
      const wrapped = block.classList.toggle('code-wrapped');
      block.querySelector('pre')?.classList.toggle('wrap', wrapped);
      (event.currentTarget as HTMLElement).setAttribute('aria-pressed', String(wrapped));
    });
    block.querySelector('[data-code-download]')?.addEventListener('click', () => {
      const url = URL.createObjectURL(
        new Blob([source() + '\n'], { type: 'text/plain;charset=utf-8' }),
      );
      const anchor = Object.assign(document.createElement('a'), {
        href: url,
        download: block.dataset.codeFilename || 'snippet.txt',
      });
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    block.querySelector('.copy-code')?.addEventListener('click', async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const label = button.querySelector<HTMLElement>('[data-code-copy-label]')!;
      try {
        await navigator.clipboard.writeText(source());
        label.textContent = t("Copied");
        button.dataset.copied = 'true';
        button.setAttribute('aria-label', t("Copied"));
      } catch {
        label.textContent = t("Select code");
        button.setAttribute('aria-label', t("Select code to copy"));
      }
      setTimeout(() => {
        label.textContent = t("Copy");
        delete button.dataset.copied;
        button.setAttribute('aria-label', t("Copy code"));
      }, 1800);
    });
  });
  const reveal = () => {
    let hash: string;
    try {
      hash = decodeURIComponent(location.hash.slice(1));
    } catch {
      return;
    }
    const target = document.getElementById(hash);
    if (!target?.closest('.code-enhanced')) return;
    let parent: HTMLElement | null = target.parentElement;
    while (parent) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      if (parent.classList.contains('ec-section'))
        parent.querySelector('details')?.setAttribute('open', '');
      parent = parent.parentElement;
    }
    target.scrollIntoView({
      block: 'center',
      behavior:
        document.documentElement.dataset.reduceMotion === 'true' ||
        matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
    });
  };
  if (!watchingHash) {
    watchingHash = true;
    addEventListener('hashchange', reveal);
    if (location.hash) reveal();
  }
}
