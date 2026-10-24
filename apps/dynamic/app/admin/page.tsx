import { Notes } from './Notes';
export const dynamic = 'force-dynamic';
export default function Page() {
  return (
    <>
      <span className="eyebrow">Verified administrator</span>
      <h1>A private working space.</h1>
      <p>
        Notes live only in this prototype’s D1 database. Changes use a revision number to prevent
        overwriting a newer edit.
      </p>
      <Notes />
    </>
  );
}
