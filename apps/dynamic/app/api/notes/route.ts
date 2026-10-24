import { environment } from '../../../lib/environment';
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const idPattern = /^[a-f0-9-]{36}$/;
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { DB } = environment();
    const result = await DB.prepare(
      'SELECT id,text,author,version,created_at,updated_at FROM notes ORDER BY updated_at DESC LIMIT 100',
    )
      .bind()
      .all();
    return json({ notes: result.results });
  } catch {
    return json(
      { error: 'Database unavailable. Configure the prototype D1 binding and apply migrations.' },
      503,
    );
  }
}
async function input(request: Request) {
  const raw = await request.text();
  if (raw.length > 6000) throw Error('Note is too long.');
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid note.');
  return value;
}
export async function POST(request: Request) {
  try {
    const data = await input(request);
    if (
      Object.keys(data).some((k) => k !== 'text') ||
      typeof data.text !== 'string' ||
      !data.text.trim() ||
      data.text.length > 4000
    )
      return json({ error: 'Enter a note of 1–4000 characters.' }, 400);
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    await environment()
      .DB.prepare(
        'INSERT INTO notes(id,text,author,version,created_at,updated_at) VALUES(?,?,?,1,?,?)',
      )
      .bind(id, data.text.trim(), request.headers.get('X-Glass-Admin'), now, now)
      .run();
    return json({ id }, 201);
  } catch {
    return json(
      { error: 'Could not create this note. Check its length and database configuration.' },
      400,
    );
  }
}
export async function PATCH(request: Request) {
  try {
    const data = await input(request);
    if (
      Object.keys(data).some((k) => !['id', 'text', 'version'].includes(k)) ||
      !idPattern.test(data.id) ||
      typeof data.text !== 'string' ||
      !data.text.trim() ||
      data.text.length > 4000 ||
      !Number.isInteger(data.version)
    )
      return json({ error: 'Invalid note update.' }, 400);
    const result = await environment()
      .DB.prepare('UPDATE notes SET text=?,version=version+1,updated_at=? WHERE id=? AND version=?')
      .bind(data.text.trim(), new Date().toISOString(), data.id, data.version)
      .run();
    return result.meta.changes
      ? json({ ok: true })
      : json({ error: 'This note changed. Reload before updating.' }, 409);
  } catch {
    return json({ error: 'Could not update this note.' }, 503);
  }
}
export async function DELETE(request: Request) {
  try {
    const data = await input(request);
    if (
      Object.keys(data).some((k) => !['id', 'version'].includes(k)) ||
      !idPattern.test(data.id) ||
      !Number.isInteger(data.version)
    )
      return json({ error: 'Invalid note selection.' }, 400);
    const result = await environment()
      .DB.prepare('DELETE FROM notes WHERE id=? AND version=?')
      .bind(data.id, data.version)
      .run();
    return result.meta.changes
      ? json({ ok: true })
      : json({ error: 'This note changed. Reload before removing.' }, 409);
  } catch {
    return json({ error: 'Could not remove this note.' }, 503);
  }
}
