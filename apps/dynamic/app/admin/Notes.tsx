'use client';
import { useEffect, useState } from 'react';
type Note = { id: string; text: string; author: string; version: number; updated_at: string };
export function Notes() {
  const [notes, setNotes] = useState<Note[]>([]),
    [text, setText] = useState(''),
    [editing, setEditing] = useState<Note | null>(null),
    [removing, setRemoving] = useState<Note | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch('/api/notes/');
    const result = (await response.json()) as { error?: string; notes: Note[] };
    if (!response.ok) throw Error(result.error || 'Request failed.');
    setNotes(result.notes);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function change(method: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/notes/', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string; notes: Note[] };
      if (!response.ok) throw Error(result.error || 'Request failed.');
      await load();
      setText('');
      setEditing(null);
      setRemoving(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="prototype-panel glass-panel">
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            className="text-link"
            onClick={() => void load().catch((e) => setError(e.message))}
          >
            Reload notes
          </button>
        </p>
      )}
      <form
        className="note-form"
        onSubmit={(e) => {
          e.preventDefault();
          void change(editing ? 'PATCH' : 'POST', {
            text,
            ...(editing ? { id: editing.id, version: editing.version } : {}),
          });
        }}
      >
        <label htmlFor="note">{editing ? 'Edit note' : 'New note'}</label>
        <textarea
          id="note"
          value={text}
          maxLength={4000}
          rows={4}
          required
          onChange={(e) => setText(e.target.value)}
        />
        <div className="note-actions">
          <button className="button primary" disabled={busy}>
            {editing ? 'Save changes' : 'Create note'}
          </button>
          {editing && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setEditing(null);
                setText('');
              }}
            >
              Cancel edit
            </button>
          )}
        </div>
      </form>
      <div className="note-list">
        {notes.map((note) => (
          <article key={note.id}>
            <p>{note.text}</p>
            <small>
              {note.author} · {new Date(note.updated_at).toLocaleString()} · revision {note.version}
            </small>
            <div className="note-actions">
              <button
                className="text-link"
                disabled={busy}
                onClick={() => {
                  setEditing(note);
                  setText(note.text);
                }}
              >
                Edit
              </button>
              <button className="text-link" disabled={busy} onClick={() => setRemoving(note)}>
                Remove
              </button>
              {removing?.id === note.id && (
                <>
                  <span>Remove this note?</span>
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() => void change('DELETE', { id: note.id, version: note.version })}
                  >
                    Confirm removal
                  </button>
                  <button className="text-link" onClick={() => setRemoving(null)}>
                    Keep note
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
