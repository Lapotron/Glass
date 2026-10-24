import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '../shared/ui.js';
import { attachmentAccept, attachmentFile, attachmentGroup } from '../shared/attachments.js';
import { api, type MediaFile } from './api.js';
import { ErrorBox } from './components.js';
export const attachmentTitle = (name: string) => name.replace(/-[a-f\d-]{36}(?=\.[^.]+$)/i, '');
export function FileLinkPicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (file: MediaFile) => void;
}) {
  const [files, setFiles] = useState<MediaFile[]>([]),
    [loading, setLoading] = useState(true),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState('');
  const [query, setQuery] = useState(''),
    [group, setGroup] = useState('All files'),
    [limit, setLimit] = useState(50),
    [retry, setRetry] = useState(0);
  const alive = useRef(true),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    alive.current = true;
    setLoading(true);
    void api<MediaFile[]>('media')
      .then((result) => {
        if (active) {
          setFiles(result.filter((file) => attachmentFile(file.name)));
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [retry]);
  const upload = async (file?: File) => {
    if (!file) return;
    setError('');
    if (!attachmentFile(file.name)) {
      setError(
        'Choose a PDF, audio, video, document or archive. Use the image picker for pictures.',
      );
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Choose a file smaller than 20 MiB.');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api<MediaFile>('media', { method: 'POST', body: form });
      if (!alive.current) return;
      setFiles((previous) => [result, ...previous]);
      setQuery('');
      setGroup('All files');
      onSelect(result);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setUploading(false);
      if (input.current) input.current.value = '';
    }
  };
  const filtered = files.filter(
    (file) =>
      (group === 'All files' || attachmentGroup(file.name) === group) &&
      `${file.displayName || ''} ${attachmentTitle(file.name)} ${file.url}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  return (
    <div className="file-link-picker">
      <ErrorBox error={error} />
      <p
        className="help"
        data-ui={
          'PDFs, audio, video, documents and archives from your notebook. Only files referenced by public pages are published.'
        }
      >
        {t(
          'PDFs, audio, video, documents and archives from your notebook. Only files referenced by public pages are published.',
        )}
      </p>
      <div className="file-link-tools">
        <label className="search-field">
          <Icon name="Search" size={15} />
          <input
            type="search"
            aria-label={t('Search local files')}
            placeholder={t('Search files…')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(50);
            }}
            data-ui-attrs={'{"aria-label":"Search local files","placeholder":"Search files…"}'}
          />
        </label>
        <select
          aria-label={t('File type')}
          value={group}
          onChange={(event) => {
            setGroup(event.target.value);
            setLimit(50);
          }}
          data-ui-attrs={'{"aria-label":"File type"}'}
        >
          {['All files', 'PDF', 'Audio', 'Video', 'Document', 'Archive'].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <Button
          className="small"
          icon="Upload"
          disabled={uploading}
          onClick={() => input.current?.click()}
        >
          {uploading ? t('Uploading…') : t('Upload file')}
        </Button>
        <input
          ref={input}
          type="file"
          accept={attachmentAccept}
          aria-label={t('Upload local attachment')}
          hidden
          disabled={uploading}
          onChange={(event) => void upload(event.target.files?.[0])}
          data-ui-attrs={'{"aria-label":"Upload local attachment"}'}
        />
      </div>
      <div
        className="link-target-list"
        role="group"
        aria-label={t('Local files')}
        data-ui-attrs={'{"aria-label":"Local files"}'}
      >
        {loading ? (
          <p className="help" role="status" data-ui={'Loading files…'}>
            {t('Loading files…')}
          </p>
        ) : filtered.length ? (
          filtered.slice(0, limit).map((file) => {
            const category = attachmentGroup(file.name);
            return (
              <button
                type="button"
                key={file.url}
                aria-pressed={selected === file.url}
                onClick={() => onSelect(file)}
              >
                <Icon
                  name={
                    category === 'Audio'
                      ? 'Radio'
                      : category === 'Video'
                        ? 'Play'
                        : category === 'Archive'
                          ? 'Archive'
                          : 'FileText'
                  }
                  size={18}
                />
                <span>
                  <strong>{file.displayName || attachmentTitle(file.name)}</strong>
                  <small>
                    {category} ·{' '}
                    {file.bytes >= 1024 * 1024
                      ? (file.bytes / 1024 / 1024).toFixed(1) + ' MB'
                      : (file.bytes / 1024).toFixed(1) + ' KB'}
                    <br />
                    {file.url}
                  </small>
                </span>
                <Icon name="ChevronRight" size={14} />
              </button>
            );
          })
        ) : (
          <p className="help">
            {files.length
              ? t('No matching files. Clear the search or choose another file type.')
              : t('No local files yet. Upload a file to link it.')}
          </p>
        )}
      </div>
      {error && (
        <Button className="small" onClick={() => setRetry((value) => value + 1)}>
          <UiText message={'Reload files'} />
        </Button>
      )}
      {filtered.length > limit && (
        <Button className="small" onClick={() => setLimit((value) => value + 50)}>
          <UiText message={'Show more files'} />
        </Button>
      )}
      <p className="help" role="status">
        {filtered.length} {filtered.length === 1 ? t('file') : t('files')}{' '}
        <UiText message={' · Uploads up to 20 MiB'} />
      </p>
    </div>
  );
}
