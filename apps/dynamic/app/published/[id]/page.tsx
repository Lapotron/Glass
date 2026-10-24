import snapshot from '../../../.generated/published.json';
import { notFound } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = snapshot.entries.find((entry) => entry.id === id);
  if (!entry) notFound();
  return (
    <>
      <a href="/published/" className="text-link">
        ← Published snapshot
      </a>
      <h1>{entry.title}</h1>
      <p>{entry.summary}</p>
      <p>
        <a className="text-link" href={entry.url} target="_blank" rel="noreferrer">
          Open production article ↗
        </a>
      </p>
      <article
        className="prototype-panel glass-panel snapshot-prose"
        dangerouslySetInnerHTML={{ __html: entry.html }}
      />
    </>
  );
}
