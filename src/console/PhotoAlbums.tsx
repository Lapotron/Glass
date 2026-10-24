import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import {
  defaultCollections,
  collectionIndexRoute,
  type CollectionsConfig,
} from '../shared/collections.js';
import { useState } from 'react';
import { photoAlbumSchema, type Library, type PhotoAlbum } from '../shared/contracts.js';
import {
  resolveAlbums,
  saveAlbum,
  removeAlbum,
  albumRoute,
  type ResolvedAlbum,
} from '../shared/albums.js';
import { headingSlug } from '../shared/utils.js';
import { Button, Icon } from '../shared/ui.js';
import { Field, Modal, ErrorBox } from './components.js';
export function PhotoAlbums({
  collections = defaultCollections,
  library,
  revision,
  onSave,
  onOpen,
}: {
  collections?: CollectionsConfig;
  library: Library;
  revision: string;
  onSave: (next: Library, expectedRevision: string) => Promise<void>;
  onOpen: (name: string) => void;
}) {
  const albums = resolveAlbums(library);
  const [draft, setDraft] = useState<PhotoAlbum | null>(null),
    [original, setOriginal] = useState<ResolvedAlbum | undefined>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [removing, setRemoving] = useState<ResolvedAlbum | null>(null),
    [sourceRevision, setSourceRevision] = useState(revision),
    [destination, setDestination] = useState('');
  const checkRevision = () => {
    if (sourceRevision !== revision)
      throw new Error(
        'Albums changed outside this dialog. Your edits are kept. Close and reopen it to review the latest version.',
      );
  };
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      checkRevision();
      const parsed = photoAlbumSchema.safeParse(draft);
      if (!parsed.success)
        throw new Error(
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
        );
      await onSave(saveAlbum(library, parsed.data, original), sourceRevision);
      setDraft(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const deleteAlbum = async () => {
    if (!removing) return;
    setBusy(true);
    setError('');
    try {
      checkRevision();
      await onSave(removeAlbum(library, removing, destination), sourceRevision);
      setRemoving(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="studio-albums" aria-label={t("Photo albums")} data-ui-attrs={"{\"aria-label\":\"Photo albums\"}"} >
      <div className="studio-albums-heading">
        <div>
          <h2>
            <Icon name="FolderOpen" size={18} />
            <UiText message={"Albums"}/></h2>
          <p data-ui={"Give a collection its own cover, story and public page."}>{t("Give a collection its own cover, story and public page.")}</p>
        </div>
        <Button
          className="small"
          icon="Plus"
          onClick={() => {
            setSourceRevision(revision);
            setOriginal(undefined);
            setDraft({
              id: crypto.randomUUID(),
              name: '',
              slug: '',
              description: '',
              cover: '',
              aliases: [],
            });
            setError('');
          }}
        >
          <UiText message={"New album"}/></Button>
      </div>
      <div className="studio-album-grid">
        {albums.map((album) => (
          <article className="studio-album glass-panel" key={album.id}>
            <button
              className="studio-album-open"
              onClick={() => onOpen(album.name)}
              aria-label={t("View album {value0}", {value0: album.name})}
            >
              {album.effectiveCover ? (
                <img src={album.effectiveCover} alt="" loading="lazy" />
              ) : (
                <span className="album-placeholder">
                  <Icon name="Image" size={24} />
                </span>
              )}
              <span>
                <strong>{album.name}</strong>
                <small>
                  {album.photos.length} {album.photos.length === 1 ? t("moment") : t("moments")}
                </small>
              </span>
            </button>
            <div className="studio-album-actions">
              <button
                className="icon-button"
                aria-label={t("Edit album {value0}", {value0: album.name})}
                onClick={() => {
                  setSourceRevision(revision);
                  setOriginal(album);
                  setDraft({
                    id: album.legacy ? crypto.randomUUID() : album.id,
                    name: album.name,
                    slug: album.slug,
                    description: album.description,
                    cover: album.cover,
                    aliases: album.aliases,
                  });
                  setError('');
                }}
              >
                <Icon name="PenLine" size={14} />
              </button>
              {album.photos.length > 0 && (
                <a
                  className="icon-button"
                  href={albumRoute(album, collections)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t("Open album {value0}", {value0: album.name})}
                >
                  <Icon name="ExternalLink" size={14} />
                </a>
              )}
              <button
                className="icon-button"
                aria-label={t("Delete album {value0}", {value0: album.name})}
                onClick={() => {
                  setSourceRevision(revision);
                  setRemoving(album);
                  setError('');
                  setDestination(
                    albums.find((a) => a.id !== album.id)?.name ||
                      (album.name === 'My journal' ? 'Unsorted' : 'My journal'),
                  );
                }}
              >
                <Icon name="Trash2" size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!albums.length && (
        <p className="help" data-ui={"Create an album before adding moments, or name one in the photo dialog."}>
          {t("Create an album before adding moments, or name one in the photo dialog.")}</p>
      )}
      {draft && (
        <Modal
          title={original ? t("Edit album") : t("Create an album")}
          onClose={() => setDraft(null)}
          footer={
            <>
              <Button onClick={() => setDraft(null)}><UiText message={"Cancel"}/></Button>
              <Button
                variant="primary"
                icon={busy ? 'LoaderCircle' : 'Check'}
                disabled={busy}
                onClick={() => void submit()}
              >
                <UiText message={"Save album"}/></Button>
            </>
          }
        >
          <Field label={t("Album name")}>
            <input
              value={draft.name}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  name: e.target.value,
                  ...(!original && (!draft.slug || draft.slug === headingSlug(draft.name))
                    ? { slug: headingSlug(e.target.value) }
                    : {}),
                })
              }
            />
          </Field>
          <Field
            label={t("Album path")}
            help={t("A single segment below {value0}. Earlier paths remain redirects after a rename.", {value0: collectionIndexRoute('life', collections)})}
          >
            <div className="album-path">
              <span>{collectionIndexRoute('life', collections)}</span>
              <input
                aria-label={t("Album path")}
                value={draft.slug}
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
               data-ui-attrs={"{\"aria-label\":\"Album path\"}"} />
              <span>/</span>
            </div>
          </Field>
          <Field label={t("Album description")}>
            <textarea
              rows={3}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </Field>
          <Field
            label={t("Cover photo")}
            help={t("Choose a moment from this album. Automatic cover uses the newest photo.")}
          >
            <label className="check-label">
              <input
                type="radio"
                name="album-cover"
                checked={!draft.cover}
                onChange={() => setDraft({ ...draft, cover: '' })}
              />
              <UiText message={"Automatic cover"}/></label>
            <div className="album-cover-grid">
              {original?.photos.map((photo) => (
                <label key={photo.id} title={photo.caption || photo.alt}>
                  <input
                    type="radio"
                    name="album-cover"
                    checked={draft.cover === photo.src}
                    onChange={() => setDraft({ ...draft, cover: photo.src })}
                  />
                  <img src={photo.src} alt={photo.alt} />
                </label>
              ))}
            </div>
          </Field>
          <ErrorBox error={error} />
        </Modal>
      )}
      {removing && (
        <Modal
          title={t("Delete {value0}?", {value0: removing.name})}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button onClick={() => setRemoving(null)}><UiText message={"Cancel"}/></Button>
              <Button
                variant="primary"
                icon="Trash2"
                disabled={busy}
                onClick={() => void deleteAlbum()}
              >
                <UiText message={"Delete album"}/></Button>
            </>
          }
        >
          <p>
            {removing.photos.length
              ? t("Move its {value0} moments to another album. The photos are kept.", {value0: removing.photos.length})
              : t("This empty album will be removed.")}
          </p>
          {!!removing.photos.length && (
            <Field label={t("Move moments to")}>
              <input
                list="album-destinations"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              />
              <datalist id="album-destinations">
                {albums
                  .filter((a) => a.id !== removing.id)
                  .map((a) => (
                    <option key={a.id} value={a.name} />
                  ))}
              </datalist>
            </Field>
          )}
          <ErrorBox error={error} />
        </Modal>
      )}
    </section>
  );
}
