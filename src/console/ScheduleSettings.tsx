import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useState } from 'react';
import { Button, Icon } from '../shared/ui.js';
import type { SiteConfig, PublicEntry } from '../shared/contracts.js';
import type { ScheduleState } from '../server/scheduler.js';
import { api, send } from './api.js';
import { Field, ToggleField, ErrorBox } from './components.js';
type Status = ScheduleState & { entries: PublicEntry[] };
export function ScheduleSettings({
  value,
  onChange,
  onSave,
}: {
  value: SiteConfig['publishing'];
  onChange: (value: SiteConfig['publishing']) => void;
  onSave: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = async () => setStatus(await api<Status>('schedule'));
  useEffect(() => {
    void refresh().catch((error) => setError(error.message));
  }, []);
  async function run() {
    setBusy(true);
    setError('');
    try {
      await onSave();
      await send('schedule/run', 'POST', {});
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="settings-card-heading">
        <Icon name="Clock3" />
        <h2 data-ui={"Scheduled publication"}>{t("Scheduled publication")}</h2>
      </div>
      <p className="help" data-ui={"Scheduled entries stay private until their publication time. The local Studio server checks every minute while it is running."}>
        {t("Scheduled entries stay private until their publication time. The local Studio server checks every minute while it is running.")}</p>
      <ToggleField
        label={t("Automatic schedule checks")}
        checked={value.scheduleEnabled}
        onChange={(scheduleEnabled) => onChange({ ...value, scheduleEnabled })}
      />
      <Field label={t("When an entry becomes due")}>
        <select
          value={value.scheduleAction}
          onChange={(event) =>
            onChange({ ...value, scheduleAction: event.target.value as 'build' | 'publish' })
          }
        >
          <option value="build" data-ui={"Publish locally & build static pages"}>{t("Publish locally & build static pages")}</option>
          <option value="publish" data-ui={"Build & upload to Cloudflare Pages"}>{t("Build & upload to Cloudflare Pages")}</option>
        </select>
      </Field>
      <p className="help">
        <UiText message={"For an always-on computer or an external scheduler, run "}/><code>npm run schedule:run</code><UiText message={". Failed uploads wait for review and a manual retry."}/></p>
      <ErrorBox error={error || status?.error || ''} />
      <Button
        icon={busy ? 'LoaderCircle' : 'Play'}
        disabled={busy || status?.running}
        onClick={() => void run()}
      >
        {busy
          ? t("Checking…")
          : value.scheduleAction === 'publish'
            ? t("Check due entries & publish")
            : t("Check due entries & build")}
      </Button>
      {status?.lastRun && (
        <p className="help">
          <UiText message={"Last checked "}/>{new Date(status.lastRun).toLocaleString()}
          {status.jobId && ` · Job ${status.jobId}`}
        </p>
      )}
      <div className="scheduled-list">
        {status?.entries.length ? (
          <>
            <h3 data-ui={"Upcoming entries"}>{t("Upcoming entries")}</h3>
            {status.entries.map((entry) => (
              <article key={entry.id}>
                <Icon name="Clock3" size={15} />
                <div>
                  <strong>{entry.title}</strong>
                  <time dateTime={entry.publishAt}>
                    {new Date(entry.publishAt).toLocaleString()}
                  </time>
                </div>
              </article>
            ))}
          </>
        ) : (
          <p className="help" data-ui={"Choose “Scheduled” in an entry's publication status to add it here."}>
            {t("Choose “Scheduled” in an entry's publication status to add it here.")}</p>
        )}
      </div>
    </>
  );
}
