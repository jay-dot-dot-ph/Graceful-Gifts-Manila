const databaseName = 'ggm-admin-appearance';
const storeName = 'images';
const backgroundKey = 'chat-background';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other admin tabs and try again.'));
  });
}

async function transact(mode, action) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export const loadAdminBackground = () => transact('readonly', (store) => store.get(backgroundKey));
export const saveAdminBackground = (file) => transact('readwrite', (store) => store.put(file, backgroundKey));
export const removeAdminBackground = () => transact('readwrite', (store) => store.delete(backgroundKey));
