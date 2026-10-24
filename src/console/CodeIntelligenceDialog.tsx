import { useState } from 'react';
import { t } from '../shared/i18n.js';
import { Button } from '../shared/ui.js';
import { Modal, Field, ErrorBox } from './components.js';
import type { CodeDialog } from './code-intelligence.js';

export function CodeIntelligenceDialog({
  value,
  onClose,
}: {
  value: CodeDialog;
  onClose: () => void;
}) {
  const [name, setName] = useState(value.name || ''),
    [error, setError] = useState('');
  const run = (action: () => void) => {
    try {
      action();
      onClose();
    } catch (error) {
      setError((error as Error).message);
    }
  };
  return (
    <Modal
      title={t(value.title)}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Close')}</Button>
          {value.rename && (
            <Button variant="primary" onClick={() => run(() => value.rename!(name))}>
              {t('Rename symbol')}
            </Button>
          )}
        </>
      }
    >
      {value.message && <p className="help">{t(value.message)}</p>}
      {value.rename && (
        <Field label={t('New symbol name')}>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') run(() => value.rename!(name));
            }}
          />
        </Field>
      )}
      <ErrorBox error={error} />
      <div className="code-location-list">
        {value.locations?.map((location, index) => (
          <button className="code-location" key={index} onClick={() => run(location.go)}>
            <strong>{location.label}</strong>
            <code>{location.detail}</code>
          </button>
        ))}
        {value.fixes?.map((fix, index) => (
          <Button key={index} onClick={() => run(fix.apply)}>
            {fix.label}
          </Button>
        ))}
      </div>
    </Modal>
  );
}
