import { useCallback, useEffect, useState } from 'react';

/**
 * Sistema de notificaciones (toasts) sin Context: un store a nivel de
 * módulo con un patrón simple de pub/sub. Cualquier componente puede llamar
 * a `showSuccess`/`showError` y el `<ToastViewport>` montado una sola vez en
 * `App.jsx` los renderiza. Evita un Provider adicional solo para esto.
 */

let toasts = [];
let idCounter = 0;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener(toasts));
}

function removeToast(id) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

function addToast({ message, variant = 'info', duration = 5000 }) {
  const id = ++idCounter;
  toasts = [...toasts, { id, message, variant }];
  emit();
  if (duration) {
    setTimeout(() => removeToast(id), duration);
  }
  return id;
}

export function useToast() {
  const [state, setState] = useState(toasts);

  useEffect(() => {
    listeners.add(setState);
    return () => listeners.delete(setState);
  }, []);

  const showToast = useCallback((message, options = {}) => addToast({ message, ...options }), []);
  const showSuccess = useCallback((message) => addToast({ message, variant: 'success' }), []);
  const showError = useCallback((message) => addToast({ message, variant: 'error', duration: 7000 }), []);
  const showInfo = useCallback((message) => addToast({ message, variant: 'info' }), []);
  const showWarning = useCallback((message) => addToast({ message, variant: 'warning', duration: 9000 }), []);

  return { toasts: state, showToast, showSuccess, showError, showInfo, showWarning, dismissToast: removeToast };
}
