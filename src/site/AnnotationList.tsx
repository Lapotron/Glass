import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { Icon } from '../shared/ui.js';

export function AnnotationList({
  repo,
  entryId,
  compact = false,
  preview = false,
}: {
  repo: string;
  entryId: string;
  compact?: boolean;
  preview?: boolean;
}) {
  return (
    <div
      className={`annotation-index${compact ? ' annotation-index-compact' : ''}`}
      data-annotation-index
    >
      <p className="help annotation-index-status" data-annotation-status role="status">
        {preview
          ? t("Annotations connect on the published page.")
          : t("Open Annotations to find notes on specific lines.")}
      </p>
      <ol className="annotation-items" data-annotation-items />
      <div className="annotation-index-actions">
        <button type="button" className="text-link" data-refresh-annotations disabled={preview}>
          <Icon name="History" size={13} /> <UiText message={" Refresh"}/></button>
        <button type="button" className="text-link" data-more-annotations hidden data-ui={"Load more"}>
          {t("Load more")}</button>
        <button type="button" className="text-link" data-new-annotation disabled={preview}>
          <Icon name="PenLine" size={13} /> <UiText message={" Add annotation"}/></button>
      </div>
      <a
        className="text-link annotation-index-github"
        href={`https://github.com/search?type=discussions&q=${encodeURIComponent(`repo:${repo} in:title "entry/${entryId}/line/"`)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon name="Github" size={13} /> <UiText message={" Browse on GitHub "}/><Icon name="ArrowUpRight" size={12} />
      </a>
    </div>
  );
}
