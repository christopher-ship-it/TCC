import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ToastContext, type ToastKind } from './toastContext';

interface Item {
  id: number;
  text: string;
  kind: ToastKind;
}

/** Short confirmations ("Access saved") and errors, bottom-centre, gone after a few seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(1);
  const toast = useCallback((text: string, kind: ToastKind = 'ok') => {
    const id = next.current++;
    setItems((list) => [...list.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3200);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'error' ? ' toast--error' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            {t.kind === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} color="#5cc97a" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
