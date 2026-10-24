import { t } from '../shared/i18n.js';
import { mathExtensions, stemPackages, type MathSettings } from '../shared/math-authoring.js';
import { Button, Icon } from '../shared/ui.js';

export function MathSettingsFields({
  value,
  onChange,
}: {
  value?: MathSettings;
  onChange: (value?: MathSettings) => void;
}) {
  const selected = value?.packages || [];
  const set = (packages: typeof selected) => onChange(packages.length ? { packages } : undefined);
  return (
    <div className="entry-settings-section math-package-settings">
      <h3>
        <Icon name="FlaskConical" size={16} />
        {t('Math packages')}
      </h3>
      <p className="help">
        {t(
          'Core notation includes AMS and document-local macros. Extra packages apply to this article, its source previews, and its published equations.',
        )}
      </p>
      <div className="settings-inline-actions">
        <Button className="small" onClick={() => set([])}>
          {t('Core notation')}
        </Button>
        <Button className="small" onClick={() => set(stemPackages)}>
          {t('Extended STEM')}
        </Button>
        <Button className="small" onClick={() => set([...stemPackages, 'physics'])}>
          {t('Physics')}
        </Button>
      </div>
      <div className="math-package-grid">
        {mathExtensions.map((name) => (
          <label key={name}>
            <input
              type="checkbox"
              checked={selected.includes(name)}
              onChange={(event) =>
                set(event.target.checked ? [...selected, name] : selected.filter((p) => p !== name))
              }
            />
            <span>
              <code>{name}</code>
            </span>
          </label>
        ))}
      </div>
      <p className="help">
        {t(
          'Physics adds derivatives, vectors, and bra-ket notation. Its div command means divergence; use divsymbol for division.',
        )}
      </p>
      <p className="help">
        {t(
          'Only the listed MathJax extensions are supported. Arbitrary LaTeX packages and remote package loading are unavailable.',
        )}
      </p>
    </div>
  );
}
