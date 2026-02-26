/**
 * clearStaleModels.ts
 *
 * Deletes any OPFS directory whose name is not in the current valid model
 * list. Prevents 401 loops when a model ID changes between builds.
 * Runs once per session via sessionStorage guard.
 */

const VALID_MODEL_IDS = new Set([
  'lfm2-350m-q4_k_m',
  'lfm2-vl-450m-q4_0',
  'sherpa-onnx-whisper-tiny.en',
  'vits-piper-en_US-lessac-medium',
  'silero-vad-v5',
]);

const SESSION_KEY = 'opfs-cleaned-v3';

async function removeStaleEntries(dir: FileSystemDirectoryHandle): Promise<void> {
  // Cast to any — FileSystemDirectoryHandle.entries() is a valid browser API
  // but TypeScript's lib.dom.d.ts doesn't type it as an async iterable.
  const entries = (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>;
  const toDelete: string[] = [];

  for await (const [name, handle] of entries) {
    if (handle.kind === 'directory' && !VALID_MODEL_IDS.has(name)) {
      toDelete.push(name);
    }
  }

  for (const name of toDelete) {
    console.log(`[clearStaleModels] Removing stale OPFS entry: "${name}"`);
    await dir.removeEntry(name, { recursive: true });
  }
}

export async function clearStaleModels(): Promise<void> {
  if (sessionStorage.getItem(SESSION_KEY)) return;

  try {
    const root = await navigator.storage.getDirectory();

    // Scan root level
    await removeStaleEntries(root);

    // Also scan known RunAnywhere subdirectories
    const subdirs = ['runanywhere', 'models', 'ra-models'];
    for (const name of subdirs) {
      try {
        const sub = await root.getDirectoryHandle(name);
        await removeStaleEntries(sub);
      } catch {
        // Subdir doesn't exist — that's fine
      }
    }

    sessionStorage.setItem(SESSION_KEY, '1');
  } catch (err) {
    console.warn('[clearStaleModels] Could not clean OPFS:', err);
  }
}
