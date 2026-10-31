// Notes: what to remember to say on a call. Everyone keeps their own; admins and supervisors can also leave notes
// that every agent sees (for one product or all of them).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useStore } from '../store/StoreContext';
import { notesCall as call, type Note } from '../lib/notes';
import { APPS } from '../data/seed';
import { fmtDayTime } from '../lib/dates';
import { Button, Empty, Field, Input, PageHead, Select, Textarea } from '../ui/primitives';
import { useToast } from '../ui/toastContext';

export default function Notes() {
  const { currentAgent } = useStore();
  const me = currentAgent!;
  const toast = useToast();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Note> | null>(null);
  const [q, setQ] = useState('');
  const canTeam = me.role !== 'agent';
  const [product, setProduct] = useState('');
  const [audienceFilter, setAudienceFilter] = useState('');
  const myApps = APPS.filter((a) => a.live && (me.role === 'admin' || me.apps.includes(a.id)));

  const load = useCallback(() => {
    call<{ notes: Note[] }>('GET', '/api/notes').then((r) => { setNotes(r.notes); setError(null); }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (notes ?? []).filter((n) => (!product || !n.app || n.app === product) && (!audienceFilter || n.audience === audienceFilter) && (!t || `${n.title} ${n.body} ${n.ownerName}`.toLowerCase().includes(t)));
  }, [notes, q, product, audienceFilter]);
  const team = shown.filter((n) => n.audience === 'agents');
  const mine = shown.filter((n) => n.audience === 'me');
  const canChange = (n: Note) => n.ownerId === me.id || (n.audience === 'agents' && me.role === 'admin');

  async function remove(n: Note) {
    try {
      await call('DELETE', `/api/notes/${encodeURIComponent(n.id)}`);
      setNotes((cur) => (cur ?? []).filter((x) => x.id !== n.id));
      toast('Note deleted');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not delete the note');
    }
  }

  const card = (n: Note) => (
    <Card key={n.id} className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <b className="font-medium">{n.title || 'Untitled'}</b>
        {canChange(n) && (
          <span className="flex shrink-0 gap-1">
            <Button size="sm" aria-label="Edit note" icon={<Pencil size={14} />} onClick={() => setEditing(n)} />
            <Button size="sm" aria-label="Delete note" icon={<Trash2 size={14} />} onClick={() => void remove(n)} />
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{n.body}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{n.app ? APPS.find((a) => a.id === n.app)?.name ?? n.app : 'All products'}</Badge>
        <span>{n.audience === 'agents' ? `${n.ownerName} · ` : ''}{fmtDayTime(n.updatedTs)}</span>
      </div>
    </Card>
  );

  return (
    <div className="page">
      <PageHead
        title="Notes"
        desc={canTeam ? 'Your own reminders, and notes every agent sees before they call.' : 'Points to remember on a call, so nothing important is missed.'}
        actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing({ audience: 'me' })}>New note</Button>}
      />
      <div className="row" style={{ gap: 8 }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
        {canTeam && (
          <Select aria-label="Whose notes" value={audienceFilter} onChange={(e) => setAudienceFilter(e.target.value)}>
            <option value="">All notes</option>
            <option value="agents">For agents</option>
            <option value="me">Mine</option>
          </Select>
        )}
        {(q || product || audienceFilter) && <Button size="sm" variant="ghost" onClick={() => { setQ(''); setProduct(''); setAudienceFilter(''); }}>Clear filters</Button>}
        {myApps.length > 1 && (
          <Select aria-label="Product" value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">All products</option>
            {myApps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        )}
      </div>
      {error ? (
        <Empty title="Notes could not load">{error}</Empty>
      ) : notes === null ? (
        <span className="muted">Loading…</span>
      ) : (
        <>
          {(team.length > 0 || canTeam) && (
            <section className="stack" style={{ gap: 10 }}>
              <div className="section-label">{canTeam ? 'For agents' : 'From your team'}</div>
              {team.length ? <div className="grid-2">{team.map(card)}</div> : <span className="muted">No notes for agents yet. Add one and choose “All agents”.</span>}
            </section>
          )}
          <section className="stack" style={{ gap: 10 }}>
            <div className="section-label">My notes</div>
            {mine.length ? <div className="grid-2">{mine.map(card)}</div> : <span className="muted">{q ? 'Nothing matches.' : 'Nothing yet. Add what you need to remember to ask or say.'}</span>}
          </section>
        </>
      )}
      {editing && <NoteDialog note={editing} canTeam={canTeam} products={myApps} onClose={() => setEditing(null)} onSaved={(n) => { setNotes((cur) => [n, ...(cur ?? []).filter((x) => x.id !== n.id)]); setEditing(null); toast('Note saved'); }} />}
    </div>
  );
}

function NoteDialog({ note, canTeam, products, onClose, onSaved }: { note: Partial<Note>; canTeam: boolean; products: { id: string; name: string }[]; onClose: () => void; onSaved: (n: Note) => void }) {
  const [title, setTitle] = useState(note.title ?? '');
  const [body, setBody] = useState(note.body ?? '');
  const [audience, setAudience] = useState<'me' | 'agents'>(note.audience ?? 'me');
  const [app, setApp] = useState(note.app ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    try {
      const r = await call<{ note: Note }>('POST', '/api/notes', { id: note.id, title, body, audience, app });
      onSaved(r.note);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{note.id ? 'Edit note' : 'New note'}</DialogTitle>
          <DialogDescription>{audience === 'agents' ? 'Every agent sees this on their Notes page.' : 'Only you see this.'}</DialogDescription>
        </DialogHeader>
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Title" htmlFor="note-title"><Input id="note-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ask about their city" /></Field>
          <Field label="Note" htmlFor="note-body" error={err}><Textarea id="note-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What to ask, say or not forget" /></Field>
          <div className="grid-2" style={{ gap: 12 }}>
            {canTeam && (
              <Field label="Who sees it" htmlFor="note-aud">
                <Select id="note-aud" value={audience} onChange={(e) => setAudience(e.target.value as 'me' | 'agents')}>
                  <option value="me">Just me</option>
                  <option value="agents">All agents</option>
                </Select>
              </Field>
            )}
            <Field label="Show it when calling" htmlFor="note-app">
              <Select id="note-app" value={app} onChange={(e) => setApp(e.target.value)}>
                <option value="">Every product</option>
                {products.map((a) => <option key={a.id} value={a.id}>{a.name} customers</option>)}
              </Select>
            </Field>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy || (!title.trim() && !body.trim())} onClick={() => void save()}>Save note</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
