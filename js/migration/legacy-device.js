// Explicit, read-only import of quizzes left by v1. Never a normal data source.
export async function readLegacyDeviceQuizzes() {
  if (!globalThis.indexedDB) return [];
  if (indexedDB.databases) {
    const databases = await indexedDB.databases();
    if (!databases.some((d) => d.name === "axiom-quiz-v1")) return [];
  }
  return new Promise((resolve) => {
    const request = indexedDB.open("axiom-quiz-v1");
    request.onupgradeneeded = () => request.transaction.abort();
    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("quizzes")) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction("quizzes", "readonly"),
        read = tx.objectStore("quizzes").getAll();
      read.onsuccess = () => {
        const values = read.result;
        db.close();
        resolve(values);
      };
      read.onerror = () => {
        db.close();
        resolve([]);
      };
    };
  });
}
