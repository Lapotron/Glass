import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../shared/ui.js';
import type { SelectedItem } from '../shared/operations.js';
import { ErrorBox, Modal } from './components.js';
import { send, isCloudStudio } from './api.js';
import './operations.css';

export function useSelection<T extends SelectedItem>(available: T[], resetKey = '') {
  const [chosen, setChosen] = useState(new Map<string, SelectedItem>());
  useEffect(() => {
    setChosen(new Map());
  }, [resetKey]);
  const items = [...chosen.values()];
  const stale = items.filter(
    (item) =>
      !available.some((record) => record.id === item.id && record.revision === item.revision),
  );
  return {
    items,
    count: items.length,
    stale,
    has: (id: string) => chosen.has(id),
    clear: () => setChosen(new Map()),
    toggle: (item: SelectedItem) =>
      setChosen((previous) => {
        const next = new Map(previous);
        if (next.has(item.id)) next.delete(item.id);
        else if (next.size < 500) next.set(item.id, { id: item.id, revision: item.revision });
        return next;
      }),
    select: (records: SelectedItem[], checked = true) =>
      setChosen((previous) => {
        const next = new Map(previous);
        records.forEach((item) => {
          if (!checked) next.delete(item.id);
          else if (next.size < 500) next.set(item.id, { id: item.id, revision: item.revision });
        });
        return next;
      }),
    refresh: () =>
      setChosen(
        new Map(
          available
            .filter((item) => chosen.has(item.id))
            .map(({ id, revision }) => [id, { id, revision }]),
        ),
      ),
  };
}
export type Selection = ReturnType<typeof useSelection>;
export function SelectionCheck({
  label,
  checked,
  mixed = false,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="selection-checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
export function SelectionToolbar({
  selection,
  matching,
  children,
}: {
  selection: Selection;
  matching: SelectedItem[];
  children: ReactNode;
}) {
  if (!selection.count) return null;
  return (
    <div
      className="selection-toolbar glass-panel"
      role="region"
      aria-label={t('Selection actions')}
      data-ui-attrs={'{"aria-label":"Selection actions"}'}
    >
      <div className="selection-summary">
        <strong>
          {selection.count} <UiText message={' selected'} />
        </strong>
        <Button className="small" variant="ghost" onClick={selection.clear}>
          <UiText message={'Clear selection'} />
        </Button>
        {matching.length > selection.count && matching.length <= 500 && (
          <Button className="small" variant="ghost" onClick={() => selection.select(matching)}>
            <UiText message={'Select all '} />
            {matching.length} <UiText message={' matching'} />
          </Button>
        )}
        {matching.length > 500 && (
          <span className="small-caption" data-ui={'Up to 500 items per operation'}>
            {t('Up to 500 items per operation')}
          </span>
        )}
      </div>
      {selection.stale.length > 0 ? (
        <div className="selection-stale" role="status">
          {selection.stale.length} <UiText message={' selected items changed.'} />{' '}
          <Button className="small" onClick={selection.refresh}>
            <UiText message={'Refresh selection'} />
          </Button>
        </div>
      ) : (
        <div className="selection-actions">{children}</div>
      )}
    </div>
  );
}
export function PageSelection({
  selection,
  items,
}: {
  selection: Selection;
  items: SelectedItem[];
}) {
  const count = items.filter((item) => selection.has(item.id)).length;
  return (
    <label className="selection-page">
      <SelectionCheck
        label={t('Select visible items')}
        checked={!!items.length && count === items.length}
        mixed={count > 0 && count < items.length}
        onChange={(checked) => selection.select(items, checked)}
      />
      <span data-ui={'Select visible'}>{t('Select visible')}</span>
    </label>
  );
}
export function Pagination({
  page,
  total,
  size,
  onPage,
}: {
  page: number;
  total: number;
  size: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="list-pagination">
      <span>
        {total
          ? t('{value0}–{value1} of {value2}', {
              value0: (page - 1) * size + 1,
              value1: Math.min(page * size, total),
              value2: total,
            })
          : t('0 items')}
      </span>
      <div>
        <Button
          className="small"
          icon="ChevronLeft"
          aria-label={t('Previous')}
          title={t('Previous page')}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <span className="pagination-label" data-ui={'Previous'}>
            {t('Previous')}
          </span>
        </Button>
        <span>
          <UiText message={'Page '} />
          {page} <UiText message={' of '} />
          {pages}
        </span>
        <Button
          className="small"
          icon="ChevronRight"
          aria-label={t('Next')}
          title={t('Next page')}
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <span className="pagination-label" data-ui={'Next'}>
            {t('Next')}
          </span>
        </Button>
      </div>
    </div>
  );
}
export function BatchDialog({
  title,
  names,
  children,
  destructive = false,
  confirmLabel = 'Apply changes',
  onClose,
  onConfirm,
}: {
  title: string;
  names: string[];
  children?: ReactNode;
  destructive?: boolean;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            <UiText message={'Cancel'} />
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            disabled={busy}
            icon={busy ? 'LoaderCircle' : destructive ? 'Trash2' : 'Check'}
            onClick={() => {
              setBusy(true);
              setError('');
              void onConfirm()
                .then(onClose)
                .catch((error) => setError(error.message))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? t('Working…') : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="modal-intro">
        {names.length} {names.length === 1 ? t('item') : t('items')}{' '}
        <UiText
          message={
            ' selected. The operation succeeds together or leaves all selected items unchanged.'
          }
        />
      </p>
      <ul className="operation-names">
        {names.slice(0, 20).map((name, index) => (
          <li key={index}>{name}</li>
        ))}
        {names.length > 20 && (
          <li>
            <UiText message={'And '} />
            {names.length - 20} <UiText message={' more'} />
          </li>
        )}
      </ul>
      {children}
      <ErrorBox error={error} />
    </Modal>
  );
}
export function downloadUrl(url: string, filename = '') {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}
export async function exportSelection(
  kind: 'content' | 'backups' | 'media',
  items: SelectedItem[],
) {
  if (kind === 'backups' && isCloudStudio()) {
    const { downloadCloudBackup } = await import('./cloud-backup.js');
    for (const item of items) await downloadCloudBackup(item.id);
    return;
  }
  if (isCloudStudio()) {
    const result = await send<{ id: string }>(kind + '/export', 'POST', { items });
    const { downloadCloudBackup } = await import('./cloud-backup.js');
    await downloadCloudBackup(result.id, 'export');
    return;
  }
  const result = await send<{ url: string }>(kind + '/export', 'POST', { items });
  downloadUrl(result.url);
}
