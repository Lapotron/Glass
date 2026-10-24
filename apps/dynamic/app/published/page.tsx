import snapshot from '../../.generated/published.json';
export const dynamic = 'force-dynamic';
export default function Page() {
  return (
    <>
      <span className="eyebrow">Published-only snapshot</span>
      <h1>The notebook, compiled.</h1>
      <p>
        Snapshot: {snapshot.generatedAt}. Drafts, credentials, revisions, and the authoring engine
        stay outside this app.
      </p>
      <div className="snapshot-list">
        {snapshot.entries.map((entry) => (
          <a className="glass-panel" key={entry.id} href={`/published/${entry.id}/`}>
            <h2>{entry.title}</h2>
            <p>{entry.summary}</p>
            <small>{entry.publishedAt}</small>
          </a>
        ))}
      </div>
    </>
  );
}
