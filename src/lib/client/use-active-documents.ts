"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "crisp-active-docs";

/** Documents currently selected for querying. Persisted in localStorage. */
export function useActiveDocuments() {
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setActiveIds(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const persist = useCallback((ids: string[]) => {
    setActiveIds(ids);
    try {
      localStorage.setItem(KEY, JSON.stringify(ids));
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(
    (id: string) => {
      persist(activeIds.includes(id) ? activeIds.filter((x) => x !== id) : [...activeIds, id]);
    },
    [activeIds, persist]
  );

  return { activeIds, setActiveIds: persist, toggle, hydrated };
}
