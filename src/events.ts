// A one-line pub/sub so a change made on one screen reaches the others.
//
// The three screens sit inside a PagerView, which keeps all of them mounted at
// once. Each was reading the database only when it first appeared, so a task
// swiped into the trash showed up there only after the app was restarted. Now
// every write announces itself and whoever is listening reloads.

import { useEffect } from 'react';

type Listener = () => void;

const listeners = new Set<Listener>();

/** Call after any write that another screen might be showing. */
export function dataChanged(): void {
  // Copy first: a listener is free to unsubscribe while we are notifying.
  for (const listener of [...listeners]) listener();
}

/** `handler` must be stable - wrap it in useCallback. */
export function useDataChange(handler: Listener): void {
  useEffect(() => {
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, [handler]);
}
