import { useRef, useState } from 'react';
import { t, uiDate } from '../shared/i18n.js';
import { Icon } from '../shared/ui.js';
import { Modal } from './components.js';
import './studio-version.css';

declare const __GLASS_STUDIO_BUILD__: import('../../scripts/studio-build-info.js').StudioBuildInfo;
const build = __GLASS_STUDIO_BUILD__;

export function StudioVersion() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  const version = 'v' + build.version;
  const revision = build.commit?.slice(0, 7);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className={`studio-version${revision ? ' has-revision' : ''}`}
        aria-label={t('Studio version: {version}', {
          version: version + (revision ? ' · ' + revision : ''),
        })}
        title={t('Show build details')}
        onClick={() => setOpen(true)}
      >
        <Icon name="GitBranch" size={12} />
        <span className="studio-version-number">{version}</span>
        {revision && (
          <>
            <span className="studio-version-divider" aria-hidden="true">
              ·
            </span>
            <code>{revision}</code>
          </>
        )}
        {build.modified && (
          <span className="studio-version-modified" aria-hidden="true">
            *
          </span>
        )}
      </button>
      {open && (
        <Modal title={t('Studio version')} onClose={close} className="studio-version-dialog">
          <p className="help">
            {t(
              'This identifies the Studio interface loaded in this tab. Reload after deploying an update.',
            )}
          </p>
          <dl className="studio-build-facts">
            <div>
              <dt>{t('Version')}</dt>
              <dd>{version}</dd>
            </div>
            <div>
              <dt>{t('Source commit')}</dt>
              <dd>
                <code>{build.commit || t('Unavailable')}</code>
              </dd>
            </div>
            <div>
              <dt>{t('Built at')}</dt>
              <dd>
                <time dateTime={build.builtAt}>
                  {uiDate(build.builtAt, { dateStyle: 'medium', timeStyle: 'long' })}
                </time>
              </dd>
            </div>
            <div>
              <dt>{t('Build mode')}</dt>
              <dd>{build.development ? t('Development') : t('Production')}</dd>
            </div>
          </dl>
          {build.modified && <p className="help">{t('Includes uncommitted source changes.')}</p>}
        </Modal>
      )}
    </>
  );
}
