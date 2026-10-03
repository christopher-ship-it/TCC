import { createContext, useContext } from 'react';

export type ToastKind = 'ok' | 'error';

export const ToastContext = createContext<{ toast: (text: string, kind?: ToastKind) => void }>({ toast: () => undefined });

export function useToast() {
  return useContext(ToastContext).toast;
}
