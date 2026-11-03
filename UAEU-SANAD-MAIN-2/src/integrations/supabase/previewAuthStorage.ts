/**
 * Session storage for the data client. Local only — no preview/cloud broker.
 */
export function brokeredPreviewStorage(): Storage {
  if (typeof window === "undefined") {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (key) => map.get(key) ?? null,
      key: (index) => [...map.keys()][index] ?? null,
      removeItem: (key) => {
        map.delete(key);
      },
      setItem: (key, value) => {
        map.set(key, value);
      },
    } as Storage;
  }
  return window.sessionStorage;
}
