// Notes: what an agent wants to remember to ask or say. Kept on the server (server/store.ts), so they only exist
// in the shared-database mode. A note can be for one product; the call panel shows the ones for the product of the
// customer on the line.
import type { AppId } from '../data/types';

export interface Note {
  id: string;
  ownerId: string;
  ownerName: string;
  /** 'me': private to the author. 'agents': left by an admin or supervisor for every agent. */
  audience: 'me' | 'agents';
  /** The product it is for; none = every product. */
  app?: string;
  title: string;
  body: string;
  createdTs: number;
  updatedTs: number;
}

export async function notesCall<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`);
  return json;
}

/** The notes that apply when calling a customer of this product: for everything, or for exactly this product. Team notes first. */
export function notesForProduct(notes: Note[], app: AppId): Note[] {
  return notes.filter((n) => !n.app || n.app === app).sort((a, b) => Number(b.audience === 'agents') - Number(a.audience === 'agents') || b.updatedTs - a.updatedTs);
}
