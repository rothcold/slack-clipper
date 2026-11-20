import { type Destination, isDestination } from './config';

// Extension-origin IndexedDB works in both an event page and a service worker.
// No storage permission or message bridge that grants page scripts access.
function access(change?: Destination | null): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('slack-clipper', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('settings');
    open.onerror = () => reject(new Error('Storage unavailable'));
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('settings', change === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('settings');
      const request = change === undefined ? store.get('destination') :
        change === null ? store.delete('destination') : store.put(change, 'destination');
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onabort = () => { db.close(); reject(new Error('Storage unavailable')); };
    };
  });
}

export async function getDestination(): Promise<Destination | null> {
  const value = await access();
  return isDestination(value) ? value : null;
}
export async function saveDestination(value: Destination | null): Promise<void> {
  if (value !== null && !isDestination(value)) throw new Error('Invalid settings');
  await access(value);
}
