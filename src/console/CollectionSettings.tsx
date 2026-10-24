import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import {
  collectionAliases,
  publicCollectionKinds,
  collectionsSchema,
  type CollectionsConfig,
} from '../shared/collections.js';
import { Icon } from '../shared/ui.js';
import { Field } from './components.js';

export function CollectionSettings({
  value,
  siteUrl,
  onChange,
}: {
  value: CollectionsConfig;
  siteUrl: string;
  onChange: (value: CollectionsConfig) => void;
}) {
  const checked = collectionsSchema.safeParse(value);
  return (
    <>
      <div className="settings-card-heading">
        <Icon name="FolderOpen" />
        <h2 data-ui={"Names and paths"}>{t("Names and paths")}</h2>
      </div>
      <p className="modal-intro" data-ui={"Choose names and public paths for your writing and visual journal."}>
        {t("Choose names and public paths for your writing and visual journal.")}</p>
      <div className="collection-settings">
        {publicCollectionKinds.map((kind) => {
          const collection = value[kind];
          const errors = checked.success
            ? []
            : checked.error.issues.filter((issue) => issue.path[0] === kind);
          const change = (patch: Partial<typeof collection>) =>
            onChange({ ...value, [kind]: { ...collection, ...patch } });
          return (
            <fieldset key={kind} data-collection-kind={kind} className="collection-settings-group">
              <legend>
                <Icon
                  name={kind === 'posts' ? 'BookOpen' : kind === 'life' ? 'Image' : 'FlaskConical'}
                  size={17}
                />
                {collection.name ||
                  (kind === 'posts' ? 'Writing' : kind === 'life' ? 'Life' : 'Lab')}
              </legend>
              <div className="field-row">
                <Field
                  label={t("Collection name")}
                  help={t("The plural or collective name, such as Posts or Pages.")}
                >
                  <input
                    value={collection.name}
                    maxLength={40}
                    onChange={(event) => change({ name: event.target.value })}
                  />
                </Field>
                <Field label={t("Singular name")} help={t("Used for one item, such as Post or Page.")}>
                  <input
                    value={collection.singular}
                    maxLength={40}
                    onChange={(event) => change({ singular: event.target.value })}
                  />
                </Field>
              </div>
              <Field
                label={t("Public path")}
                help={t("One folder name using letters, numbers or hyphens. For example: /post/ or /article/.")}
              >
                <input
                  value={collection.path}
                  maxLength={50}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  aria-invalid={errors.some((issue) => issue.path[1] === 'path') || undefined}
                  onChange={(event) => change({ path: event.target.value })}
                />
              </Field>
              <p className="collection-route-preview">
                <Icon name="LinkIcon" size={14} />
                <code>
                  {siteUrl.replace(/\/$/, '')}/
                  {collection.path.replace(/^\/+|\/+$/g, '').toLowerCase() || '…'}/
                  {kind === 'life' ? 'your-album' : 'your-title'}/
                </code>
              </p>
              {!!errors.length && (
                <p className="field-error" role="status">
                  {errors.map((issue) => issue.message).join(' ')}
                </p>
              )}
              {!!collectionAliases(kind, value).length && (
                <p className="small-caption collection-aliases">
                  <UiText message={"Earlier paths:"}/>{' '}
                  {collectionAliases(kind, value)
                    .map((alias) => `/${alias}/`)
                    .join(', ')}
                </p>
              )}
            </fieldset>
          );
        })}
      </div>
      <div className="settings-note">
        <Icon name="LinkIcon" size={18} />
        <p data-ui={"After a path change, build and publish to update the public site. Earlier paths redirect to the new address; existing Markdown links and short links keep working."}>
          {t("After a path change, build and publish to update the public site. Earlier paths redirect to the new address; existing Markdown links and short links keep working.")}</p>
      </div>
    </>
  );
}
