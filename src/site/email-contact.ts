import { t } from '../shared/i18n.js';
import { decodeContact } from '../shared/contact.js';
export function revealEmail(trigger: HTMLButtonElement) {
  if (document.querySelector('dialog.email-dialog[open]')) return;
  const href = decodeContact(trigger.dataset.emailToken || '');
  const address = decodeURIComponent(href.slice(7).split('?')[0]);
  const dialog = document.createElement('dialog');
  dialog.className = 'email-dialog glass-panel';
  dialog.setAttribute('aria-label', t("Email contact"));
  const heading = document.createElement('h2');
  heading.textContent = t("Get in touch");
  const recipient = document.createElement('p');
  recipient.className = 'email-recipient';
  recipient.textContent = address;
  const actions = document.createElement('div');
  actions.className = 'email-actions';
  const send = document.createElement('a');
  send.className = 'button primary';
  send.href = href;
  send.textContent = t("Send email");
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'button secondary';
  copy.textContent = t("Copy address");
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'button secondary';
  close.textContent = t("Close");
  const status = document.createElement('p');
  status.className = 'help';
  status.setAttribute('role', 'status');
  copy.addEventListener('click', () => {
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(address))
      .then(() => {
        status.textContent = t("Email address copied.");
      })
      .catch(() => {
        status.textContent = t("Copy is unavailable. Select the address above to copy it.");
        recipient.tabIndex = 0;
        recipient.focus();
        const range = document.createRange();
        range.selectNodeContents(recipient);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      });
  });
  const dismiss = () => {
    dialog.close();
  };
  dialog.addEventListener('close', () => {
    dialog.remove();
    trigger.focus({ preventScroll: true });
  });
  close.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dismiss();
    }
  });
  actions.append(send, copy, close);
  dialog.append(heading, recipient, actions, status);
  document.body.append(dialog);
  dialog.showModal();
}
