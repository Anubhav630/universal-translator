import type { LoaderState } from '../hooks/useModelLoader';

interface ModelBannerProps {
  state: LoaderState;
  progress: number;
  error: string | null;
  onLoad: () => void;
  label: string;
}

export function ModelBanner({ state, progress, error, label }: ModelBannerProps) {
  if (state === 'ready') return null;
  if (state === 'idle') return null;

  return (
    <div className="model-banner">
      {state === 'downloading' && (
        <>
          <span>📥 Downloading {label} model...</span>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <span>{(progress * 100).toFixed(0)}%</span>
        </>
      )}

      {state === 'loading' && (
        <>
          <span>⚙️ Loading {label} model...</span>
          <div className="spinner-small" />
        </>
      )}

      {state === 'error' && error && (
        <>
          <span className="error-text">❌ {error}</span>
        </>
      )}
    </div>
  );
}
