import { useState, useCallback, useRef } from 'react';
import { ModelManager, ModelCategory, EventBus } from '@runanywhere/web';

export type LoaderState = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

interface ModelLoaderResult {
  state: LoaderState;
  progress: number;
  error: string | null;
  ensure: () => Promise<boolean>;
  unload: () => Promise<void>;
}

/**
 * Hook to download + load a model for a given category.
 *
 * Exposes both `ensure()` (load if needed) and `unload()` (free RAM).
 * Tab switching calls `unload()` on every model not required by the new tab,
 * so only the active tab's model(s) occupy memory at any time.
 *
 * Concurrent `ensure()` calls share the same in-flight Promise instead of
 * racing or immediately returning false.
 */
export function useModelLoader(category: ModelCategory, coexist = false): ModelLoaderResult {
  const [state, setState] = useState<LoaderState>(() =>
    ModelManager.getLoadedModel(category) ? 'ready' : 'idle',
  );
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Stores the active load promise so concurrent ensure() calls join it
  const activePromiseRef = useRef<Promise<boolean> | null>(null);

  // ── ensure ────────────────────────────────────────────────────────────────
  const ensure = useCallback((): Promise<boolean> => {
    if (ModelManager.getLoadedModel(category)) {
      setState('ready');
      return Promise.resolve(true);
    }

    // Already loading — return same promise so caller awaits real result
    if (activePromiseRef.current) return activePromiseRef.current;

    const loadPromise = (async (): Promise<boolean> => {
      try {
        const models = ModelManager.getModels().filter((m) => m.modality === category);
        if (models.length === 0) {
          setError(`No ${category} model registered`);
          setState('error');
          return false;
        }

        const model = models[0];

        const download = async () => {
          setState('downloading');
          setProgress(0);
          const unsub = EventBus.shared.on('model.downloadProgress', (evt) => {
            if (evt.modelId === model.id) setProgress(evt.progress ?? 0);
          });
          await ModelManager.downloadModel(model.id);
          unsub();
          setProgress(1);
        };

        const fresh = ModelManager.getModels().find((m) => m.id === model.id);
        if (!fresh || (fresh.status !== 'downloaded' && fresh.status !== 'loaded')) {
          await download();
        }

        setState('loading');
        let ok = await ModelManager.loadModel(model.id, { coexist });

        if (!ok) {
          console.warn(`[useModelLoader] loadModel failed for "${model.id}" — re-downloading and retrying.`);
          await download();
          setState('loading');
          ok = await ModelManager.loadModel(model.id, { coexist });
        }

        if (ok) { setState('ready'); return true; }

        setError('Failed to load model. Check browser console for details.');
        setState('error');
        return false;

      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
        return false;
      } finally {
        activePromiseRef.current = null;
      }
    })();

    activePromiseRef.current = loadPromise;
    return loadPromise;
  }, [category, coexist]);

  // ── unload ────────────────────────────────────────────────────────────────
  const unload = useCallback(async (): Promise<void> => {
    const loaded = ModelManager.getLoadedModel(category);
    if (!loaded) return; // nothing to do

    try {
      await ModelManager.unloadModel(loaded.id);
    } catch (err) {
      console.warn(`[useModelLoader] unloadModel failed for category "${category}":`, err);
    } finally {
      // Reset state so the next ensure() re-loads cleanly
      setState('idle');
      setProgress(0);
      setError(null);
      activePromiseRef.current = null;
    }
  }, [category]);

  return { state, progress, error, ensure, unload };
}
