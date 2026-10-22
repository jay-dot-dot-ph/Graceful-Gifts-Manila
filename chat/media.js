// Media is deliberately opt-in: Cloud Storage requires a Blaze project.
const TYPES = new Map([
  ['image/jpeg', ['photo', 8_000_000]], ['image/png', ['photo', 8_000_000]],
  ['image/webp', ['photo', 8_000_000]], ['image/gif', ['photo', 8_000_000]],
  ['video/mp4', ['video', 30_000_000]], ['video/webm', ['video', 30_000_000]],
  ['video/quicktime', ['video', 30_000_000]]
]);
let enabledPromise;
let storagePromise;
const objectUrls = new Map();
const downloads = new Map();
const observers = new WeakMap();
export function mediaEnabled() {
  if (!enabledPromise) enabledPromise = fetch('/media-config.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : {}).then((config) => config.enabled === true).catch(() => false);
  return enabledPromise;
}
export function checkFile(file) {
  const info = TYPES.get(file?.type);
  if (!info) throw new Error('Choose a JPG, PNG, WebP, GIF, MP4, WebM, or MOV file.');
  const selectionLimit = info[0] === 'photo' && file.type !== 'image/gif' ? 20_000_000 : info[1];
  if (!file.size || file.size > selectionLimit) throw new Error(info[0] === 'photo' ? 'Photos must be under 20 MB (GIFs under 8 MB).' : 'Videos must be under 30 MB.');
  return { kind: info[0], contentType: file.type, size: file.size };
}
async function prepareFile(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 1_000_000 || typeof createImageBitmap !== 'function') return file;
  try {
    const image = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
    const compressed = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
    canvas.width = 0; canvas.height = 0;
    return compressed?.type === 'image/webp' && compressed.size < file.size ? compressed : file;
  } catch { return file; }
}
async function storageFor(app, emulator) {
  if (!storagePromise) storagePromise = import('firebase/storage').then(({ getStorage, connectStorageEmulator }) => {
    const storage = getStorage(app);
    if (emulator && ['localhost', '127.0.0.1'].includes(location.hostname)) connectStorageEmulator(storage, '127.0.0.1', 9199);
    return storage;
  });
  return storagePromise;
}
export async function uploadMedia(app, emulator, conversationId, messageId, uid, file, onProgress) {
  const checked = checkFile(file);
  if (!await mediaEnabled()) throw new Error('Photo and video sharing is not enabled yet.');
  const upload = await prepareFile(file);
  if (upload.size > TYPES.get(upload.type)?.[1]) throw new Error('This photo could not be reduced below 8 MB. Choose a smaller photo.');
  const storage = await storageFor(app, emulator);
  const { ref, uploadBytesResumable } = await import('firebase/storage');
  const path = `chatMedia/${conversationId}/${messageId}/file`;
  const task = uploadBytesResumable(ref(storage, path), upload, { contentType: upload.type, customMetadata: { uploaderUid: uid } });
  await new Promise((resolve, reject) => task.on('state_changed', (snapshot) => onProgress?.(Math.round(snapshot.bytesTransferred * 100 / snapshot.totalBytes)), reject, resolve));
  return { kind: checked.kind, contentType: upload.type, size: upload.size, path };
}
export async function deleteChatMedia(app, emulator, conversationId, messageId, media) {
  if (media?.path !== `chatMedia/${conversationId}/${messageId}/file`) throw new Error('Invalid chat attachment path.');
  const storage = await storageFor(app, emulator);
  const { ref, deleteObject } = await import('firebase/storage');
  try { await deleteObject(ref(storage, media.path)); }
  catch (error) { if (error.code !== 'storage/object-not-found') throw error; }
  const old = objectUrls.get(media.path); if (old) { URL.revokeObjectURL(old); objectUrls.delete(media.path); }
}
export function mediaMarkup(media, conversationId, messageId) {
  if (!media || media.path !== `chatMedia/${conversationId}/${messageId}/file` || !TYPES.has(media.contentType)) return '';
  const label = media.kind === 'photo' ? 'Photo' : 'Video';
  return `<div class="chat-media" data-media-path="${media.path}" data-media-kind="${media.kind}" role="status">Loading ${label.toLowerCase()}…</div>`;
}
export async function hydrateMedia(container, app, emulator) {
  const nodes = [...container.querySelectorAll('[data-media-path]')].filter((node) => !node.querySelector('img,video'));
  if (!nodes.length) return;
  const storage = await storageFor(app, emulator);
  const { ref, getBlob } = await import('firebase/storage');
  async function loadNode(node) {
    const path = node.dataset.mediaPath;
    try {
      let url = objectUrls.get(path);
      if (!url) {
        if (!downloads.has(path)) downloads.set(path, getBlob(ref(storage, path)).then((blob) => {
          const created = URL.createObjectURL(blob); objectUrls.set(path, created);
          while (objectUrls.size > 24) { const oldest = objectUrls.keys().next().value; URL.revokeObjectURL(objectUrls.get(oldest)); objectUrls.delete(oldest); }
          return created;
        }).finally(() => downloads.delete(path)));
        url = await downloads.get(path);
      }
      if (!node.isConnected || node.dataset.mediaPath !== path) return;
      node.replaceChildren();
      if (node.dataset.mediaKind === 'photo') {
        const image = document.createElement('img'); image.src = url; image.alt = 'Chat photo'; image.loading = 'lazy'; node.append(image);
      } else {
        const video = document.createElement('video'); video.src = url; video.controls = true; video.preload = 'metadata'; video.playsInline = true; node.append(video);
        const link = document.createElement('a'); link.href = url; link.download = 'chat-video'; link.textContent = 'Download video'; node.append(link);
      }
      node.removeAttribute('role');
    } catch { if (node.isConnected) node.textContent = 'Media unavailable. Check your connection or access.'; }
  }
  observers.get(container)?.disconnect();
  if (typeof IntersectionObserver !== 'function') { nodes.forEach(loadNode); return; }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); loadNode(entry.target); }
  }, { root: container, rootMargin: '160px' });
  observers.set(container, observer);
  nodes.forEach((node) => observer.observe(node));
}
window.addEventListener('pagehide', () => { for (const url of objectUrls.values()) URL.revokeObjectURL(url); objectUrls.clear(); });
