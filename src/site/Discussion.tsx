import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import type { DiscussionConfig } from '../shared/discussions.js';
import { Icon } from '../shared/ui.js';
import { scriptJson } from '../shared/utils.js';

export function Discussion({
  config,
  term,
  id = 'discussion',
  preview = false,
  lang = 'en',
  title = config.title,
  description = config.description,
  compact = false,
  embedded = false,
}: {
  config: DiscussionConfig;
  term: string;
  id?: string;
  preview?: boolean;
  lang?: string;
  title?: string;
  description?: string;
  compact?: boolean;
  embedded?: boolean;
}) {
  return (
    <section
      className={
        compact
          ? 'article-discussion line-conversation'
          : embedded
            ? 'article-discussion discussion-embedded'
            : 'article-discussion glass-panel'
      }
      id={id}
      lang={lang}
      data-comments={scriptJson(config)}
      data-comment-term={term}
      data-comment-theme="/assets/discussion-"
      data-discussion-state={preview ? 'preview' : 'idle'}
      aria-labelledby={compact ? undefined : `${id}-heading`}
    >
      {!compact && (
        <div className="discussion-heading">
          <span className="section-icon">
            <Icon name="MessageCircle" size={18} />
          </span>
          <div>
            <h2 id={`${id}-heading`}>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
      )}
      <p className="discussion-metadata" data-discussion-meta hidden />
      <div className="discussion-actions">
        <button type="button" className="button secondary" data-load-comments disabled={preview}>
          <Icon name="MessageCircle" size={15} /> <UiText message={" Load discussion"}/></button>
        <a
          className="text-link"
          data-comment-link
          href={`https://github.com/${config.repo}/discussions`}
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="Github" size={16} /> <UiText message={" Open on GitHub "}/><Icon name="ArrowUpRight" size={14} />
        </a>
        <button
          type="button"
          className="text-link discussion-copy"
          data-copy-discussion
          disabled={preview}
        >
          <Icon name="LinkIcon" size={14} /> <UiText message={" Copy conversation link"}/></button>
      </div>
      <p className="help discussion-status" role="status" aria-live="polite" data-comments-status>
        {preview
          ? t("Discussions connect on the published page. This preview stays private.")
          : config.onDemand
            ? t("Load the conversation to connect to GitHub.")
            : t("The conversation loads as you approach.")}
      </p>
      <div className="giscus" />
      <noscript>
        <p className="help" data-ui={"Read and join this conversation on GitHub."}>{t("Read and join this conversation on GitHub.")}</p>
      </noscript>
    </section>
  );
}
