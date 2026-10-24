import { t } from '../shared/i18n.js';
import { missingMediaReferences, type MediaUsage } from '../shared/operations.js';

export function MissingMedia({ items }: { items: MediaUsage[] }) {
  const { current } = missingMediaReferences(items);
  return (
    <>
      {current.length > 0 && (
        <section
          className="settings-card glass-panel media-missing-current"
          aria-label={t('Missing media references')}
        >
          <h3>{t('Missing media references')}</h3>
          <p className="help">
            {t('These files are referenced by current content, including drafts and settings.')}
          </p>
          <ul className="media-usage-list">
            {current.map((item) => (
              <li key={item.url}>
                <code>{item.url}</code> · {item.active.join(', ')}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
