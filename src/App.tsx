import { useState, useEffect } from 'react';
import { initSDK, getAccelerationMode } from './runanywhere';
import { clearStaleModels } from './clearStaleModels';
import { TranslatorTab } from './components/TranslatorTab';
import { AlphabetBackground } from './components/AlphabetBackground';

type AppState = 'checking' | 'needs-reload' | 'loading' | 'ready' | 'error';

export function App() {
  const [appState, setAppState] = useState<AppState>('checking');
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [accel, setAccel] = useState<string | null>(null);

  useEffect(() => {
    // Require Cross-Origin Isolation for SharedArrayBuffer (ONNX WASM backend)
    if (!window.crossOriginIsolated) {
      setAppState('needs-reload');
      return;
    }

    sessionStorage.removeItem('coi-reload');

    (async () => {
      // Remove any stale OPFS model entries from previous builds before the
      // SDK tries to load them (prevents 401 loops from renamed model IDs)
      await clearStaleModels();

      initSDK()
        .then(() => {
          setAccel(getAccelerationMode());
          setAppState('ready');
        })
        .catch((err) => {
          setSdkError(err instanceof Error ? err.message : String(err));
          setAppState('error');
        });
    })();
  }, []);

  if (appState === 'checking') {
    return (
      <div className="app-loading">
        <AlphabetBackground />
        <div className="spinner" />
      </div>
    );
  }

  if (appState === 'needs-reload') {
    return (
      <div className="app-loading">
        <AlphabetBackground />
        <h2>🔄 One-Time Reload Required</h2>
        <p style={{ maxWidth: 400, textAlign: 'center', marginBottom: '1.5rem' }}>
          This page was loaded from cache without the security headers needed for
          on-device AI. A single reload will fix it.
        </p>
        <button className="btn btn-primary btn-lg" onClick={() => window.location.reload()}>
          Reload Now
        </button>
      </div>
    );
  }

  if (appState === 'loading') {
    return (
      <div className="app-loading">
        <AlphabetBackground />
        <div className="spinner" />
        <h2>Loading Universal Translator...</h2>
        <p>Initializing on-device AI engine</p>
      </div>
    );
  }

  if (appState === 'error') {
    return (
      <div className="app-loading">
        <h2>⚠️ Startup Error</h2>
        <pre className="error-text" style={{ whiteSpace: 'pre-wrap', textAlign: 'left', maxWidth: 520 }}>
          {sdkError}
        </pre>
      </div>
    );
  }

  return (
    <>
      <AlphabetBackground />
      <div className="app">
        <header className="app-header">
          <h1>🌐 Universal Translator</h1>
          {accel && <span className="badge">{accel === 'webgpu' ? 'WebGPU' : 'CPU'}</span>}
        </header>
        <main className="tab-content">
          <TranslatorTab />
        </main>
      </div>
    </>
  );
}
