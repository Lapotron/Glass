import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useState } from 'react';
import type { Job } from '../shared/contracts.js';
import { Icon, type IconName } from '../shared/ui.js';
import { buildProgress, elapsedTime } from './build-progress.js';
import { isCloudStudio } from './api.js';

export function BuildProgress({ job }: { job: Job }) {
  const info = buildProgress(job, isCloudStudio()),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!info.active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [info.active]);
  const duration =
    info.active || job.completedAt
      ? elapsedTime(job.startedAt, info.active ? now : Date.parse(job.completedAt!))
      : null;
  return (
    <section
      className={`job-progress ${info.failed ? 'is-failed' : info.succeeded ? 'is-complete' : 'is-active'}`}
      aria-label={t("Job progress")}
      data-state={job.state}
     data-ui-attrs={"{\"aria-label\":\"Job progress\"}"} >
      <div className="job-progress-heading">
        <div className="job-progress-copy" role="status">
          <strong>{info.label}</strong>
          <p>{info.detail}</p>
        </div>
        {duration && (
          <span
            className="job-progress-time"
            aria-label={t("{value0} {value1}", {value0: info.active ? 'Elapsed' : 'Duration', value1: duration})}
          >
            <Icon name="Clock3" size={13} />
            {duration}
          </span>
        )}
      </div>
      <div
        className="job-progress-track"
        role="progressbar"
        aria-label={info.barLabel}
        aria-valuemin={0}
        aria-valuemax={info.total}
        aria-valuenow={info.done}
        aria-valuetext={info.detail}
        data-indeterminate={info.done === undefined}
      >
        <span
          className="job-progress-fill"
          style={{ width: info.done === undefined ? '34%' : `${(info.done / info.total) * 100}%` }}
        />
      </div>
      <ol
        className="job-progress-stages"
        aria-label={t("Job stages")}
        style={{ gridTemplateColumns: `repeat(${info.steps.length}, minmax(0, 1fr))` }}
       data-ui-attrs={"{\"aria-label\":\"Job stages\"}"} >
        {info.steps.map((step, index) => {
          const state =
            index < info.index
              ? 'done'
              : index === info.index
                ? info.failed
                  ? 'failed'
                  : 'current'
                : 'waiting';
          return (
            <li
              key={step.key}
              data-stage={step.key}
              data-status={state}
              aria-current={index === info.index ? 'step' : undefined}
            >
              <span className="job-stage-mark">
                <Icon
                  name={
                    state === 'done'
                      ? 'Check'
                      : state === 'failed'
                        ? 'AlertCircle'
                        : (step.icon as IconName)
                  }
                  size={14}
                />
              </span>
              <span>{step.label}</span>
              <span className="sr-only">
                {state === 'done'
                  ? t("Complete")
                  : state === 'failed'
                    ? t("Stopped here")
                    : state === 'current'
                      ? t("In progress")
                      : t("Waiting")}
              </span>
            </li>
          );
        })}
      </ol>
      {job.mediaProgress && (
        <div className="job-progress-metrics">
          <span>
            <Icon name="Image" size={12} />
            {job.mediaProgress.total} <UiText message={" images"}/></span>
          <span>
            <Icon name="CloudUpload" size={12} />
            {job.mediaProgress.uploaded} <UiText message={" uploaded"}/></span>
          <span>{(job.mediaProgress.bytes / 1024 / 1024).toFixed(1)} <UiText message={" MiB media"}/></span>
        </div>
      )}
    </section>
  );
}
