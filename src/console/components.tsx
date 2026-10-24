import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon, Button } from '../shared/ui.js';
import { ImagePreparation } from './ImagePreparation.js';
import { api, type MediaFile } from './api.js';
import './media-picker.css';
import { imageFile } from '../shared/attachments.js';
export function Modal({
  title,
  children,
  onClose,
  footer,
  wide = false,
  className = '',
  dismissible = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-modal-focus]')?.focus({ preventScroll: true });
    // Close while still connected so the native dialog restores its opener's focus.
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={`studio-modal ${wide ? 'wide' : ''} ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (dismissible) onClose();
      }}
      onClick={(event) => {
        if (dismissible && event.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          disabled={!dismissible}
          aria-label={t('Close {value0}', { value0: title })}
        >
          <Icon name="X" />
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  );
}
export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  const helpId = useId();
  return (
    <label className="field">
      <span>{label}</span>
      {Children.map(children, (child) => {
        if (
          !isValidElement<{ 'aria-label'?: string; 'aria-describedby'?: string }>(child) ||
          typeof child.type !== 'string' ||
          !['input', 'textarea', 'select'].includes(child.type)
        )
          return child;
        return cloneElement(child, {
          'aria-label': child.props['aria-label'] || label,
          ...(help
            ? {
                'aria-describedby': [child.props['aria-describedby'], helpId]
                  .filter(Boolean)
                  .join(' '),
              }
            : {}),
        });
      })}
      {help && <small id={helpId}>{help}</small>}
    </label>
  );
}
export function ToggleField({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>
        {label}
        {help && <small>{help}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="studio-page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  );
}
export function MediaPicker({
  onSelect,
  onClose,
  rasterOnly = false,
}: {
  onSelect: (url: string) => void;
  onClose: () => void;
  rasterOnly?: boolean;
}) {
  const [files, setFiles] = useState<MediaFile[]>([]),
    [error, setError] = useState(''),
    [uploads, setUploads] = useState<File[]>([]);
  const [query, setQuery] = useState(''),
    [loading, setLoading] = useState(true);
  const search = useRef<HTMLInputElement>(null),
    countId = useId();
  useEffect(() => {
    let active = true;
    void api<MediaFile[]>('media')
      .then((result) => {
        if (active) setFiles(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const selectable = files.filter((file) =>
    rasterOnly ? /\.(png|jpe?g|webp|avif|gif)$/i.test(file.name) : imageFile(file.name),
  );
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = selectable.filter((file) =>
    terms.every((term) =>
      `${file.displayName || ''} ${file.name} ${file.url}`.toLocaleLowerCase().includes(term),
    ),
  );
  return (
    <>
      <Modal
        title={t('Choose from your media')}
        className="media-picker-dialog"
        wide
        onClose={onClose}
        footer={
          <label className="button secondary">
            <Icon name="Upload" />
            <UiText message={'Upload an image'} />
            <input
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setUploads([f]);
              }}
            />
          </label>
        }
      >
        <div className="media-picker-toolbar">
          <div className="search-field media-picker-search">
            <Icon name="Search" size={16} />
            <input
              ref={search}
              type="search"
              data-modal-focus
              aria-label={t('Search media')}
              aria-describedby={countId}
              placeholder={t('Search by filename…')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              data-ui-attrs={'{"aria-label":"Search media","placeholder":"Search by filename…"}'}
            />
            {query && (
              <button
                type="button"
                className="icon-button media-search-clear"
                aria-label={t('Clear media search')}
                onClick={() => {
                  setQuery('');
                  search.current?.focus();
                }}
                data-ui-attrs={'{"aria-label":"Clear media search"}'}
              >
                <Icon name="X" size={14} />
              </button>
            )}
          </div>
          <span className="small-caption media-picker-count" id={countId} role="status">
            {loading
              ? t('Loading images…')
              : error
                ? t('Images unavailable')
                : t('{value0} of {value1} images', {
                    value0: matches.length,
                    value1: selectable.length,
                  })}
          </span>
        </div>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div
          className="media-picker-grid"
          role="group"
          aria-label={t('Available images')}
          aria-busy={loading}
          data-ui-attrs={'{"aria-label":"Available images"}'}
        >
          {matches.map((file) => (
            <button
              type="button"
              key={file.url}
              aria-label={file.displayName || file.name}
              onClick={() => {
                onSelect(file.url);
                onClose();
              }}
            >
              <img src={file.url} alt="" loading="lazy" />
              <span>{file.displayName || file.name}</span>
            </button>
          ))}
        </div>
        {!loading && !error && !matches.length && (
          <p className="help media-picker-empty">
            {selectable.length && terms.length
              ? t('No images match “{value0}”. Try another filename or clear the search.', {
                  value0: query.trim(),
                })
              : rasterOnly
                ? t('Upload a PNG, JPEG, WebP, AVIF, or GIF image to use as artwork.')
                : t('Upload an image to start your collection.')}
          </p>
        )}
      </Modal>
      {!!uploads.length && (
        <ImagePreparation
          files={uploads}
          onClose={() => setUploads([])}
          onUploaded={(file) => {
            onSelect(file.url);
            onClose();
          }}
        />
      )}
    </>
  );
}
export function JobStatus({ state }: { state: string }) {
  const good = state === 'succeeded',
    bad = state === 'failed',
    busy = !good && !bad;
  return (
    <span className={`job-status ${good ? 'good' : bad ? 'bad' : 'busy'}`}>
      <Icon
        name={good ? 'CheckCircle2' : bad ? 'AlertCircle' : 'LoaderCircle'}
        size={13}
        className={busy ? 'spin' : ''}
      />
      {good
        ? t('Complete')
        : bad
          ? t('Needs attention')
          : state[0].toUpperCase() + state.slice(1).replaceAll('-', ' ')}
    </span>
  );
}
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <p className="error-message" role="alert">
      {error}
    </p>
  ) : null;
}
export function CopyButton({
  value,
  label = 'Copy',
  ariaLabel,
  iconOnly = false,
}: {
  value: string;
  label?: string;
  ariaLabel?: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      className={iconOnly ? 'small compact-copy' : 'small'}
      aria-label={ariaLabel}
      title={ariaLabel || label}
      icon={copied ? 'Check' : 'Copy'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {iconOnly ? undefined : copied ? t('Copied') : label}
    </Button>
  );
}
