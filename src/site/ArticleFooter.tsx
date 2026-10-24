import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { Icon } from '../shared/ui.js';
import { imageSet } from '../shared/utils.js';
import { routeFor, formatDate, type SiteConfig } from '../shared/contracts.js';
import { resolveEntrySettings } from '../shared/entry-settings.js';
import { shortLinkPath } from '../shared/shortlinks.js';
import { articleCitations } from '../shared/article-citation.js';
import { articleQrSvg } from '../engine/article-qr.js';
import type { RenderedEntry } from './pages.js';

export function ArticleFooter({
  entry,
  site,
  preview,
}: {
  entry: RenderedEntry;
  site: SiteConfig;
  preview: boolean;
}) {
  const { reading } = resolveEntrySettings(site, entry);
  if (!reading.articleFooter) return null;
  const canonical = new URL(routeFor(entry, site.collections), site.url).href;
  const short = entry.shortCode ? new URL(shortLinkPath(entry), site.url).href : '';
  const citations = articleCitations({
    id: entry.id,
    title: entry.title,
    url: canonical,
    site: site.name,
    ...(reading.author ? { author: site.profile.name } : {}),
    ...(reading.publishedDate ? { publishedAt: entry.publishedAt } : {}),
    ...(reading.modifiedDate && entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
  });
  return (
    <footer
      className="article-bottom glass-panel"
      role="group"
      aria-label={t("Article details and actions")}
      data-article-footer
      data-private={preview || undefined}
      data-canonical={preview ? undefined : canonical}
      data-shortlink={(!preview && short) || undefined}
      data-article-title={entry.title}
      data-article-slug={entry.slug}
     data-ui-attrs={"{\"aria-label\":\"Article details and actions\"}"} >
      {(reading.author ||
        reading.publishedDate ||
        reading.readingTime ||
        (reading.modifiedDate && entry.updatedAt)) && (
        <div className="article-footer-identity">
          {reading.author && (
            <a href="/about/" className="article-footer-author">
              {site.profile.portrait ? (
                <img
                  src={site.profile.portrait}
                  srcSet={imageSet(site.profile.portrait)}
                  sizes="40px"
                  alt=""
                  width={40}
                  height={40}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="article-author-mark">
                  <Icon name="UserRound" size={22} />
                </span>
              )}
              <span>
                <small data-ui={"Written by"}>{t("Written by")}</small>
                <strong>{site.profile.name}</strong>
                {site.profile.role && <span>{site.profile.role}</span>}
              </span>
              <Icon name="ArrowUpRight" size={15} />
            </a>
          )}
          <dl className="article-footer-facts">
            {reading.publishedDate && (
              <div data-article-fact="published">
                <dt>
                  <Icon name="CalendarDays" size={13} />
                  <UiText message={"Published"}/></dt>
                <dd>
                  <time dateTime={entry.publishedAt}>{formatDate(entry.publishedAt, true)}</time>
                </dd>
              </div>
            )}
            {reading.modifiedDate && entry.updatedAt && (
              <div data-article-fact="updated">
                <dt>
                  <Icon name="History" size={13} />
                  <UiText message={"Updated"}/></dt>
                <dd>
                  <time dateTime={entry.updatedAt}>{formatDate(entry.updatedAt, true)}</time>
                </dd>
              </div>
            )}
            {reading.readingTime && (
              <div data-article-fact="reading">
                <dt>
                  <Icon name="Clock3" size={13} />
                  <UiText message={"Reading"}/></dt>
                <dd>
                  {entry.rendered.words.toLocaleString()} <UiText message={" words · "}/>{entry.minutes} <UiText message={" min"}/></dd>
              </div>
            )}
          </dl>
        </div>
      )}
      <div className="article-footer-group">
        {preview ? (
          <p className="help" data-ui={"Sharing and citation exports are available on the published page."}>{t("Sharing and citation exports are available on the published page.")}</p>
        ) : (
          <>
            <div className="article-footer-actions" role="group" aria-label={t("Share article")} data-ui-attrs={"{\"aria-label\":\"Share article\"}"} >
              <button type="button" className="text-link article-save-reading" data-reading-bookmark disabled aria-pressed="false" data-ui="Save to reading list">{t('Save to reading list')}</button>
              <button type="button" className="text-link" data-article-action="share" disabled>
                <Icon name="Share2" size={15} />
                <UiText message={"Share"}/></button>
              <button type="button" className="text-link" data-article-action="copy" disabled>
                <Icon name="LinkIcon" size={15} />
                <UiText message={"Copy link"}/></button>
              <button type="button" className="text-link" data-article-action="print" disabled>
                <Icon name="Printer" size={15} /> <UiText message={" Print / Save PDF"}/></button>
              {short && (
                <button type="button" className="text-link" data-article-action="short" disabled>
                  <Icon name="Copy" size={15} />
                  <UiText message={"Short link"}/></button>
              )}
              <details className="article-aux" data-article-dialog="cite">
                <summary>
                  <Icon name="Quote" size={15} />
                  <UiText message={"Cite this article"}/></summary>
                <div className="article-aux-body">
                  <h3 data-ui={"Cite this article"}>{t("Cite this article")}</h3>
                  <label className="article-citation-select" hidden>
                    <UiText message={"Format"}/><select data-citation-select defaultValue="plain">
                      <option value="plain" data-ui={"Plain text"}>{t("Plain text")}</option>
                      <option value="bibtex" data-ui={"BibTeX"}>{t("BibTeX")}</option>
                      <option value="ris" data-ui={"RIS"}>{t("RIS")}</option>
                    </select>
                  </label>
                  {Object.entries(citations).map(([format, text]) => (
                    <div key={format} data-citation={format}>
                      <h4>
                        {format === 'plain' ? t("Plain text") : format === 'bibtex' ? t("BibTeX") : t("RIS")}
                      </h4>
                      <pre tabIndex={0}>{text}</pre>
                    </div>
                  ))}
                  <div className="article-footer-actions">
                    <button
                      type="button"
                      className="button secondary small"
                      data-article-action="copy-cite"
                      disabled
                    >
                      <Icon name="Copy" size={14} />
                      <UiText message={"Copy citation"}/></button>
                    <button
                      type="button"
                      className="button secondary small"
                      data-article-action="download-cite"
                      disabled
                    >
                      <Icon name="Download" size={14} />
                      <UiText message={"Download citation"}/></button>
                  </div>
                </div>
              </details>
            </div>
            <details className="article-share-more">
              <summary className="text-link">
                <Icon name="Ellipsis" size={15} /> <UiText message={" More"}/></summary>
              <div className="article-footer-disclosures">
                <a
                  className="text-link"
                  href={`mailto:?subject=${encodeURIComponent(entry.title)}&body=${encodeURIComponent(canonical)}`}
                >
                  <Icon name="Mail" size={15} />
                  <UiText message={"Email"}/></a>
                <details className="article-aux" data-article-dialog="qr">
                  <summary>
                    <Icon name="QrCode" size={15} />
                    <UiText message={"QR code"}/></summary>
                  <div className="article-aux-body">
                    <h3 data-ui={"Open on another device"}>{t("Open on another device")}</h3>
                    <div
                      className="article-qr"
                      dangerouslySetInnerHTML={{ __html: articleQrSvg(canonical) }}
                    />
                    <p className="article-canonical">{canonical}</p>
                    <button
                      type="button"
                      className="button secondary small"
                      data-article-action="download-qr"
                      disabled
                    >
                      <Icon name="Download" size={14} />
                      <UiText message={"Download QR"}/></button>
                  </div>
                </details>
                <details className="article-aux article-link-details">
                  <summary>
                    <Icon name="LinkIcon" size={15} />
                    <UiText message={"Link details"}/></summary>
                  <div className="article-aux-body">
                    <label>
                      <UiText message={"Canonical link"}/><input readOnly value={canonical} aria-label={t("Canonical article link")}  data-ui-attrs={"{\"aria-label\":\"Canonical article link\"}"} />
                    </label>
                    {short && (
                      <label>
                        <UiText message={"Short link"}/><input readOnly value={short} aria-label={t("Short article link")}  data-ui-attrs={"{\"aria-label\":\"Short article link\"}"} />
                      </label>
                    )}
                  </div>
                </details>
              </div>
            </details>
          </>
        )}
        <p className="article-action-status" data-article-status role="status" aria-live="polite" />
      </div>
    </footer>
  );
}
