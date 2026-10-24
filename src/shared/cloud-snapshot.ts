/** Keep routine captures independent of retained public artifacts, including their authorization index. */
export function snapshotSelection(requestPath: string) {
  const path = requestPath.split('?')[0];
  if (/^\/api\/notebook\/reset(?:\/|$)/.test(path))
    return { where: '1=1', values: [] as string[], includes: (_name: string) => true };
  const artifact = path.match(/^\/api\/jobs\/([\w-]+)\/artifact(?:\/|$)/)?.[1];
  const retained = (name: string) =>
    !name.startsWith('.studio/builds/') || /\/(?:source|media-transfer)\.json$/.test(name);
  const where =
    "(path NOT GLOB '.studio/builds/*' OR path GLOB '.studio/builds/*/source.json' OR path GLOB '.studio/builds/*/media-transfer.json'" +
    (artifact ? ' OR (path>=? AND path<?)' : '') +
    ") AND (path NOT GLOB '.studio/render-cache/*' OR path GLOB '.studio/render-cache/mermaid/*')";
  return {
    where,
    values: artifact
      ? ['.studio/builds/' + artifact + '/', '.studio/builds/' + artifact + '/\uffff']
      : [],
    includes: (name: string) =>
      (retained(name) || (!!artifact && name.startsWith('.studio/builds/' + artifact + '/'))) &&
      (!name.startsWith('.studio/render-cache/') ||
        name.startsWith('.studio/render-cache/mermaid/')),
  };
}
