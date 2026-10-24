import { t } from '../shared/i18n.js';
import type { ReactNode } from 'react';
import { Icon } from '../shared/ui.js';
import { encodeContact, contactLabel } from '../shared/contact.js';
export function ContactLink({
  href,
  label,
  children,
  protect = true,
  className,
  target,
  rel,
}: {
  href: string;
  label: string;
  children?: ReactNode;
  protect?: boolean;
  className?: string;
  target?: string;
  rel?: string;
}) {
  if (protect && /^mailto:/i.test(href))
    return (
      <>
        <button
          type="button"
          className={(className || '') + ' protected-email'}
          data-email-token={encodeContact(href)}
          aria-haspopup="dialog"
          disabled
          title={t("Reveal email address")}
         data-ui-attrs={"{\"title\":\"Reveal email address\"}"} >
          <Icon name="Mail" size={15} />
          {contactLabel(label)}
        </button>
        <noscript>
          <small className="email-noscript" data-ui={"Enable JavaScript to reveal email."}>{t("Enable JavaScript to reveal email.")}</small>
        </noscript>
      </>
    );
  return (
    <a href={href} className={className} target={target} rel={rel}>
      {children || label}
    </a>
  );
}
