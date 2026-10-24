export const dynamic = 'force-dynamic';
export default function Page() {
  return (
    <>
      <span className="eyebrow">An independent workspace</span>
      <h1>Room for what comes next.</h1>
      <p>
        This prototype tests authenticated server rendering and a database API, alongside a
        read-only snapshot of published writing.
      </p>
      <div className="prototype-grid">
        <a className="glass-panel" href="/admin/">
          <h2>Admin notes</h2>
          <p>Access-verified CRUD, conflict detection, and a separate D1 database.</p>
        </a>
        <a className="glass-panel" href="/published/">
          <h2>Published snapshot</h2>
          <p>
            Build-time Markdown rendering reused safely, without the local Studio or native engine
            in Workers.
          </p>
        </a>
        <article className="glass-panel">
          <h2>Independent by design</h2>
          <p>
            ACA and the production Pages site keep their existing deployments. This prototype does
            not collect reader analytics.
          </p>
        </article>
      </div>
    </>
  );
}
