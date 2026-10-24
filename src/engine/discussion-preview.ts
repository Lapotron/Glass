import { randomBytes } from 'node:crypto';
import type { SiteConfig } from '../shared/contracts.js';
import { escapeHtml } from '../shared/utils.js';
import { renderIcon } from './icons.js';
import { discussionThemeCss } from './integrations.js';

/** A local design specimen. It never loads Giscus, signs in, or sends a comment. */
export function discussionThemePreview(site: SiteConfig, mode: 'light' | 'dark') {
  const nonce = randomBytes(18).toString('base64');
  const reaction = `<button type="button" class="gsc-direct-reaction-button gsc-social-reaction-summary-item" data-demo-reaction aria-label="♡ 1 · Try a sample reaction" aria-pressed="false"><span class="gsc-direct-reaction-button-emoji">♡</span><span class="gsc-social-reaction-summary-item-count">1</span></button>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'"><title>Discussion style preview</title><style>${discussionThemeCss(site, mode)}
body{padding:22px!important;background:radial-gradient(ellipse at top right,var(--color-accent-subtle),transparent 70%),var(--gsc-preview-canvas)!important}
.gsc-main,.gsc-comments,.gsc-timeline{display:flex;flex-direction:column}.gsc-header,.gsc-left-header,.BtnGroup{display:flex;align-items:center}.gsc-left-header{flex:1}.gsc-comment-author{flex:1}.gsc-preview-intro{margin:0 0 18px;color:var(--color-fg-subtle);font-size:11px;letter-spacing:.1em;text-transform:uppercase}.gsc-preview-avatar{display:grid;place-items:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:var(--color-accent-subtle);color:var(--color-accent-fg);font-size:11px;font-weight:650}.gsc-preview-reply{display:flex;gap:10px}.gsc-preview-reply>div:last-child{flex:1;min-width:0}.gsc-reply-box>button{width:100%;text-align:left;border:1px solid var(--color-border-default)}.gsc-preview-state{min-height:1.7em;margin:12px 3px 0;color:var(--color-fg-subtle);font-size:11px}.gsc-main .markdown ul{padding-left:1.4em}.gsc-main .markdown p:only-child{margin:0}[hidden]{display:none!important}
@media(max-width:400px){body{padding:12px!important}.gsc-header{flex-wrap:wrap}}
</style></head><body><header><h1 class="gsc-preview-intro">${escapeHtml(site.branding.shortName || site.name)} · ${mode} · sample conversation</h1></header>
<main class="gsc-main">
  <div class="gsc-header"><div class="gsc-left-header"><span class="gsc-comments-count">2 comments</span></div><div class="BtnGroup" aria-label="Sample comment order"><span class="BtnGroup-item BtnGroup-item--selected"><button type="button" class="btn" data-demo-action>Oldest</button></span><span class="BtnGroup-item"><button type="button" class="btn" data-demo-action>Newest</button></span></div></div>
  <form class="gsc-comment-box">
    <div class="gsc-comment-box-tabs"><div><button type="button" class="color-text-primary color-bg-canvas" data-demo-tab="write" aria-pressed="true">Write</button><button type="button" class="color-text-secondary" data-demo-tab="preview" aria-pressed="false">Preview</button></div><div class="gsc-comment-box-md-toolbar"><button type="button" class="gsc-toolbar-item" title="Sample Markdown toolbar" aria-label="Sample Markdown toolbar" data-demo-action>${renderIcon('Code2', 16)}</button></div></div>
    <div class="gsc-comment-box-main"><div class="gsc-comment-box-write" data-demo-write><textarea class="gsc-comment-box-textarea" placeholder="Add to the conversation…" aria-label="Sample comment">A thoughtful detail makes a reading experience feel considered.</textarea><div class="gsc-comment-box-textarea-extras"><span class="gsc-comment-box-markdown-hint">Markdown supported</span></div></div><div class="markdown gsc-comment-box-preview" data-demo-preview hidden></div></div>
    <div class="gsc-comment-box-bottom"><span class="gsc-comment-box-markdown-hint">Style preview only</span><div class="gsc-comment-box-buttons"><button type="button" class="btn btn-primary" data-demo-action>${renderIcon('Github', 15)} Sign in with GitHub</button></div></div>
  </form>
  <div class="gsc-comments"><div class="gsc-timeline"><div class="gsc-comment"><div class="color-bg-primary color-border-primary">
    <div class="gsc-comment-header"><div class="gsc-comment-author"><span class="gsc-comment-author-avatar"><span class="gsc-preview-avatar">R</span><span class="link-primary">Sample reader</span></span><time>2 hours ago</time><span class="color-box-border-info">Contributor</span></div></div>
    <div class="markdown gsc-comment-content"><p>The typography and quieter controls make the discussion feel like part of the article.</p><blockquote><p>A place to exchange ideas, with room for the writing.</p></blockquote><p>Inline <code>code</code>, links, and longer replies keep their own hierarchy.</p></div>
    <div class="gsc-comment-footer"><div class="gsc-comment-reactions">${reaction}<button type="button" class="gsc-reactions-button gsc-social-reaction-summary-item" aria-label="Sample reactions" data-demo-action>${renderIcon('Smile', 14)}</button></div><span class="gsc-comment-replies-count">1 reply</span></div>
    <div class="gsc-replies"><div class="gsc-reply"><div class="gsc-preview-reply"><span class="gsc-preview-avatar">A</span><div><div class="gsc-reply-header"><div class="gsc-reply-author"><span class="link-primary">Sample author</span><time>an hour ago</time></div></div><div class="markdown gsc-reply-content"><p>Exactly. A reply stays in the thread, with a lighter background and clear contrast.</p></div><div class="gsc-reply-footer"><div class="gsc-reply-reactions">${reaction}</div></div></div></div></div></div>
    <div class="gsc-reply-box"><button type="button" data-demo-action>Write a reply…</button></div>
  </div></div></div></div>
</main><footer><p class="gsc-preview-state" role="status">Sample content · no GitHub connection or saved comments.</p></footer>
<script nonce="${nonce}">
const status=document.querySelector('[role=status]');
document.querySelector('form').addEventListener('submit',e=>e.preventDefault());
document.querySelectorAll('[data-demo-action]').forEach(button=>button.addEventListener('click',()=>{status.textContent='Style preview only. No comment or account action was sent.'}));
document.querySelectorAll('[data-demo-reaction]').forEach(button=>button.addEventListener('click',()=>{const selected=button.classList.toggle('has-reacted');button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-label','♡ '+(selected?'2':'1')+' · Try a sample reaction');button.querySelector('.gsc-social-reaction-summary-item-count').textContent=selected?'2':'1'}));
document.querySelectorAll('[data-demo-tab]').forEach(button=>button.addEventListener('click',()=>{const preview=button.dataset.demoTab==='preview';document.querySelector('[data-demo-write]').hidden=preview;const panel=document.querySelector('[data-demo-preview]');panel.hidden=!preview;panel.textContent=document.querySelector('textarea').value||'Nothing to preview';document.querySelectorAll('[data-demo-tab]').forEach(tab=>{const selected=tab===button;tab.classList.toggle('color-text-primary',selected);tab.classList.toggle('color-bg-canvas',selected);tab.setAttribute('aria-pressed',String(selected))})}));
</script></body></html>`;
}
