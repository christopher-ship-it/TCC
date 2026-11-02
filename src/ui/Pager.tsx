// Long lists show one page at a time: 20 rows, then the arrows move on to the next 20. Every list uses this one
// control, so paging looks and works the same everywhere.

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZES = [10, 20, 50, 100];

export interface PagerState {
  page: number;
  pages: number;
  total: number;
  perPage: number;
  setPage: (page: number) => void;
  setPerPage: (n: number) => void;
}

/**
 * The rows for the page on show. `resetKey` is whatever the list is filtered by: when it changes the list goes back to
 * page 1. (New data arriving doesn't move anyone off the page they're reading; a page past the end shows the last one.)
 */
export function usePaged<T>(rows: T[], resetKey: string, size = 20): { items: T[]; pager: PagerState } {
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(size);
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    setKey(resetKey);
    setPage(0);
  }
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const current = Math.min(page, pages - 1);
  return {
    items: rows.slice(current * perPage, (current + 1) * perPage),
    pager: {
      page: current,
      pages,
      total: rows.length,
      perPage,
      setPage: (p) => setPage(Math.max(0, Math.min(p, pages - 1))),
      setPerPage: (n) => {
        setPerPage(n);
        setPage(0);
      },
    },
  };
}

/** "21–40 of 1,274", rows per page, and back / next arrows. Hidden when everything fits on one page of 10. */
export function Pager({ pager, noun = 'rows' }: { pager: PagerState; noun?: string }) {
  const { page, pages, total, perPage, setPage, setPerPage } = pager;
  if (total <= PAGE_SIZES[0]) return null;
  const from = page * perPage + 1;
  const to = Math.min(total, (page + 1) * perPage);
  const n = (v: number) => v.toLocaleString('en-IN');
  return (
    <nav className="pager" aria-label={`Pages of ${noun}`}>
      <span className="pager__count">
        <b>{n(from)}–{n(to)}</b> of {n(total)} {noun}
      </span>
      <label className="pager__size">
        Show
        <select className="select select--sm" value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} aria-label="Rows per page">
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <span className="pager__nav">
        <button type="button" className="btn btn--sm btn--icon" onClick={() => setPage(page - 1)} disabled={page === 0} aria-label="Previous page"><ChevronLeft size={16} /></button>
        <span className="pager__page">Page {n(page + 1)} of {n(pages)}</span>
        <button type="button" className="btn btn--sm btn--icon" onClick={() => setPage(page + 1)} disabled={page >= pages - 1} aria-label="Next page"><ChevronRight size={16} /></button>
      </span>
    </nav>
  );
}
