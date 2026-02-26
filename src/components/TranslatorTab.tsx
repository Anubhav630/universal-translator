import { useState, useRef, useCallback, useEffect } from 'react';
import { ModelCategory, ModelManager } from '@runanywhere/web';
import { TextGeneration, VideoCapture, VLMWorkerBridge } from '@runanywhere/web-llamacpp';
import { STT, AudioCapture } from '@runanywhere/web-onnx';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';

type InputMode = 'text' | 'speech' | 'image';

interface TranslationResult {
  originalText: string;
  translatedText: string;
  detectedLanguage?: string;
  processingTimeMs: number;
}

const CAPTURE_DIM = 512;

// ---------------------------------------------------------------------------
// Supported language lists
// ---------------------------------------------------------------------------

// Speech: whisper-tiny.en is English-ONLY. Any other language will be
// misrecognised at the STT step before translation even begins.
const SPEECH_SUPPORTED_LANGUAGES = ['English'];

// Text: the LFM2 350M LLM handles all major world languages reliably.
// No restriction is enforced — this list is shown in the UI for user guidance.
const TEXT_SUPPORTED_LANGUAGES = [
  'English', 'Chinese', 'Japanese', 'Korean',
  'Arabic', 'Hindi', 'Urdu', 'Bengali', 'Persian', 'Thai', 'Vietnamese',
  'French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Dutch',
  'Russian', 'Polish', 'Swedish', 'Greek', 'Turkish', 'Hebrew',
  'Indonesian', 'Malay', 'Swahili', 'Romanian', 'Hungarian', 'Czech',
];

// Image: LFM2-VL was trained on multilingual image-text pairs and can read
// text in all scripts below. This list reflects what the 450M model handles
// reliably. Unsupported languages will show a clear error to the user.
const IMAGE_SUPPORTED_LANGUAGES = [
  'English', 'Chinese', 'Japanese', 'Korean',
  'Arabic', 'Hindi', 'Urdu', 'Bengali', 'Persian', 'Thai', 'Vietnamese',
  'French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Dutch',
  'Russian', 'Polish', 'Swedish', 'Greek', 'Turkish', 'Hebrew',
];

const SYSTEM_PROMPT = `You are a professional translator. Your task is to:
1. Detect the source language of the input text
2. Translate it accurately to English
3. Preserve the meaning, tone, and context

Respond in EXACTLY this format with no extra text:
Language: [detected language]
Translation: [English translation]

Rules:
- If the input is already in English, set Language: English and repeat the text as the Translation.
- Never add notes, disclaimers, or explanations outside the format.
- If the input is a single word or short phrase, still follow the format exactly.`;

// ---------------------------------------------------------------------------
// Helper: normalised language match
// ---------------------------------------------------------------------------
// VLM/LLM may return "Mandarin Chinese", "Traditional Chinese", "zh", etc.
// We do a case-insensitive substring match so "Mandarin" hits "Chinese".
function isLanguageSupported(detected: string, supported: string[]): boolean {
  const d = detected.toLowerCase();
  return supported.some((lang) => {
    const l = lang.toLowerCase();
    return d.includes(l) || l.includes(d);
  });
}

export function TranslatorTab() {
  const llmLoader = useModelLoader(ModelCategory.Language);
  const vlmLoader = useModelLoader(ModelCategory.Multimodal);
  const sttLoader = useModelLoader(ModelCategory.SpeechRecognition);

  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [textInput, setTextInput] = useState('');
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Speech recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [speechInputMethod, setSpeechInputMethod] = useState<'record' | 'upload'>('record');
  const [uploadedAudioFile, setUploadedAudioFile] = useState<File | null>(null);
  const audioChunksRef = useRef<Float32Array[]>([]);
  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  // Image capture state
  const [cameraActive, setCameraActive] = useState(false);
  const [imageInputMethod, setImageInputMethod] = useState<'camera' | 'upload'>('camera');
  const [uploadedImageFile, setUploadedImageFile] = useState<File | null>(null);
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);
  const videoMountRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<VideoCapture | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);

  // On mount: load only the LLM for the default text tab
  useEffect(() => {
    if (llmLoader.state === 'idle') llmLoader.ensure();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Tab switching: unload models not needed, then load required ones ──────
  //
  // RAM budget per tab:
  //   text   → Language only
  //   speech → SpeechRecognition + Language
  //   image  → Multimodal only
  //
  // Unloading first frees memory so the incoming model has room to load.
  const switchTab = useCallback(async (newMode: InputMode) => {
    if (newMode === inputMode || processing) return;
    setResult(null);
    setError(null);
    setInputMode(newMode);

    if (newMode === 'text') {
      // Unload STT and VLM, keep/load LLM
      await Promise.all([sttLoader.unload(), vlmLoader.unload()]);
      llmLoader.ensure();
    } else if (newMode === 'speech') {
      // Unload VLM only — LLM is also needed for translation after STT
      await vlmLoader.unload();
      llmLoader.ensure();
      sttLoader.ensure();
    } else if (newMode === 'image') {
      // Unload LLM and STT — VLM does OCR + translation in one pass
      await Promise.all([llmLoader.unload(), sttLoader.unload()]);
      vlmLoader.ensure();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMode, processing, llmLoader, sttLoader, vlmLoader]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      audioCaptureRef.current?.stop();
      if (captureRef.current) {
        captureRef.current.stop();
        captureRef.current.videoElement.parentNode?.removeChild(captureRef.current.videoElement);
      }
    };
  }, []);

  // ------------------------------------------------------------------
  // Text Translation
  // allowedLanguages: if provided, detected language is validated against
  // the list BEFORE setting result. Unsupported → error shown to user.
  // ------------------------------------------------------------------
  const translateText = useCallback(async (
    text: string,
    skipProcessingState = false,
    allowedLanguages?: string[],
  ) => {
    if (!text.trim()) return;
    if (!skipProcessingState) setProcessing(true);
    setError(null);
    const t0 = performance.now();

    try {
      const llmAlreadyLoaded = ModelManager.getLoadedModel(ModelCategory.Language);
      if (!llmAlreadyLoaded) {
        const ok = await llmLoader.ensure();
        if (!ok) {
          setError('Failed to load LLM model');
          if (!skipProcessingState) setProcessing(false);
          return;
        }
      }

      const llmResult = await TextGeneration.generate(text, {
        maxTokens: 512,
        temperature: 0.3,
        systemPrompt: SYSTEM_PROMPT,
      });

      const lines = llmResult.text.split('\n');
      let detectedLanguage = 'Unknown';
      let translatedText = llmResult.text;

      for (const line of lines) {
        if (line.startsWith('Language:')) detectedLanguage = line.replace('Language:', '').trim();
        else if (line.startsWith('Translation:')) translatedText = line.replace('Translation:', '').trim();
      }

      if (!llmResult.text.includes('Language:') && !llmResult.text.includes('Translation:')) {
        translatedText = llmResult.text;
      }

      // Language gate: if a whitelist was passed, validate the detected language
      if (allowedLanguages && detectedLanguage !== 'Unknown') {
        if (!isLanguageSupported(detectedLanguage, allowedLanguages)) {
          setError(
            `"${detectedLanguage}" is not in the library. ` +
            `Supported language: ${allowedLanguages.join(', ')}.`
          );
          if (!skipProcessingState) setProcessing(false);
          return;
        }
      }

      setResult({ originalText: text, translatedText, detectedLanguage, processingTimeMs: performance.now() - t0 });
    } catch (err) {
      setError(`Translation error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (!skipProcessingState) setProcessing(false);
    }
  }, [llmLoader]);

  const handleTextTranslate = useCallback(() => {
    translateText(textInput); // no language restriction for plain text
  }, [textInput, translateText]);

  // ------------------------------------------------------------------
  // Speech to Text + Translation
  // ------------------------------------------------------------------
  const startRecording = useCallback(async () => {
    setError(null);
    audioChunksRef.current = [];
    setRecordingTime(0);

    try {
      if (sttLoader.state !== 'ready') {
        const ok = await sttLoader.ensure();
        if (!ok) { setError('Failed to load STT model'); return; }
      }

      const capture = new AudioCapture({ sampleRate: 16000 });
      audioCaptureRef.current = capture;
      await capture.start((chunk: Float32Array) => { audioChunksRef.current.push(chunk); }, () => {});
      setIsRecording(true);
      recordingIntervalRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch (err) {
      setError(`Microphone error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [sttLoader]);

  const stopRecording = useCallback(async () => {
    setIsRecording(false);
    if (recordingIntervalRef.current) { clearInterval(recordingIntervalRef.current); recordingIntervalRef.current = null; }

    const capture = audioCaptureRef.current;
    if (!capture) return;
    capture.stop();
    setProcessing(true);
    setError(null);

    try {
      const totalLength = audioChunksRef.current.reduce((sum, c) => sum + c.length, 0);
      const allSamples = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of audioChunksRef.current) { allSamples.set(chunk, offset); offset += chunk.length; }

      if (totalLength === 0) { setError('No audio recorded'); setProcessing(false); return; }

      // Timeout: STT.transcribe can hang indefinitely on very long audio.
      // Reject after 60 s so the user gets an actionable error instead of
      // the spinner spinning forever.
      const transcription = await Promise.race([
        STT.transcribe(allSamples),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Speech recognition timed out. Try a shorter recording (under 30s).')), 60_000)
        ),
      ]);
      if (!transcription.text.trim()) { setError('No speech detected — please speak clearly and try again.'); setProcessing(false); return; }

      // Pass SPEECH_SUPPORTED_LANGUAGES — if LLM detects non-English, user sees clear error
      await translateText(transcription.text, true, SPEECH_SUPPORTED_LANGUAGES);
    } catch (err) {
      setError(`Speech processing error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProcessing(false);
      audioChunksRef.current = [];
    }
  }, [translateText]);

  // ------------------------------------------------------------------
  // Audio File Upload
  // ------------------------------------------------------------------
  const handleAudioFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const validTypes = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/webm', 'audio/x-wav'];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(wav|mp3|ogg|webm)$/i)) {
      setError('Please upload a valid audio file (WAV, MP3, OGG, or WebM)'); return;
    }
    if (file.size > 50 * 1024 * 1024) { setError('Audio file too large (max 50MB)'); return; }
    setUploadedAudioFile(file);
    setError(null);
  }, []);

  const processUploadedAudio = useCallback(async () => {
    if (!uploadedAudioFile) return;
    setProcessing(true);
    setError(null);

    try {
      if (sttLoader.state !== 'ready') {
        const ok = await sttLoader.ensure();
        if (!ok) { setError('Failed to load STT model'); setProcessing(false); return; }
      }

      const arrayBuffer = await uploadedAudioFile.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      let audioData: Float32Array;
      if (audioBuffer.numberOfChannels === 1) {
        audioData = audioBuffer.getChannelData(0);
      } else {
        const left = audioBuffer.getChannelData(0);
        const right = audioBuffer.getChannelData(1);
        audioData = new Float32Array(left.length);
        for (let i = 0; i < left.length; i++) audioData[i] = (left[i] + right[i]) / 2;
      }

      let samples: Float32Array;
      if (audioBuffer.sampleRate !== 16000) {
        const ratio = 16000 / audioBuffer.sampleRate;
        const newLen = Math.floor(audioData.length * ratio);
        samples = new Float32Array(newLen);
        for (let i = 0; i < newLen; i++) {
          const src = i / ratio;
          const floor = Math.floor(src);
          const ceil = Math.min(floor + 1, audioData.length - 1);
          samples[i] = audioData[floor] * (1 - (src - floor)) + audioData[ceil] * (src - floor);
        }
      } else {
        samples = audioData;
      }

      const transcription = await Promise.race([
        STT.transcribe(samples),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Speech recognition timed out. Try a shorter audio file (under 30s).')), 60_000)
        ),
      ]);
      if (!transcription.text.trim()) { setError('No speech detected in audio file.'); setProcessing(false); return; }

      // Pass SPEECH_SUPPORTED_LANGUAGES so non-English audio shows a clear error
      await translateText(transcription.text, true, SPEECH_SUPPORTED_LANGUAGES);
    } catch (err) {
      setError(`Audio file error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProcessing(false);
    }
  }, [uploadedAudioFile, sttLoader, translateText]);

  // ------------------------------------------------------------------
  // Camera
  // ------------------------------------------------------------------
  const startCamera = useCallback(async () => {
    if (captureRef.current?.isCapturing) return;
    setError(null);
    try {
      const cam = new VideoCapture({ facingMode: 'environment' });
      await cam.start();
      captureRef.current = cam;
      const mount = videoMountRef.current;
      if (mount) {
        const el = cam.videoElement;
        el.style.width = '100%';
        el.style.borderRadius = '12px';
        mount.appendChild(el);
      }
      setCameraActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NotAllowed') || msg.includes('Permission')) setError('Camera permission denied. Check your browser settings.');
      else if (msg.includes('NotFound') || msg.includes('DevicesNotFound')) setError('No camera found on this device.');
      else setError(`Camera error: ${msg}`);
    }
  }, []);

  // ------------------------------------------------------------------
  // Helper: validate image language and set result/error
  // ------------------------------------------------------------------
  const handleVLMResult = useCallback((rawText: string, t0: number) => {
    const lines = rawText.split('\n');
    let detectedLanguage = 'Unknown';
    let originalText = '';
    let translatedText = '';

    for (const line of lines) {
      if (line.startsWith('Language:'))    detectedLanguage = line.replace('Language:', '').trim();
      if (line.startsWith('Original:'))    originalText     = line.replace('Original:', '').trim();
      if (line.startsWith('Translation:')) translatedText   = line.replace('Translation:', '').trim();
    }

    // Fallback: if model didn't follow format, use whole response as translation
    if (!translatedText) translatedText = rawText;
    if (!originalText)   originalText   = rawText;

    // Language gate for image
    if (detectedLanguage !== 'Unknown' && !isLanguageSupported(detectedLanguage, IMAGE_SUPPORTED_LANGUAGES)) {
      setError(
        `"${detectedLanguage}" is not in the library. ` +
        `Supported languages: ${IMAGE_SUPPORTED_LANGUAGES.join(', ')}.`
      );
      return;
    }

    setResult({ originalText, translatedText, detectedLanguage, processingTimeMs: performance.now() - t0 });
  }, []);

  // ------------------------------------------------------------------
  // Shared VLM prompt
  // ------------------------------------------------------------------
  // VLM_PROMPT is deliberately blunt.
  // Small VLMs (450M) default to image description when given ambiguous
  // instructions. We must explicitly forbid description and give a filled
  // example so the model has a concrete output pattern to follow.
  const VLM_PROMPT =
    'You are an OCR engine. Your only job is to read text from images. ' +
    'DO NOT describe the image. DO NOT explain what you see. ' +
    'ONLY output the exact words written in the image, nothing else. ' +
    'Then identify the language and translate the text to English. ' +
    'Output ONLY in this exact format (no other words before or after):\n' +
    'Language: French\n' +
    'Original: Bonjour le monde\n' +
    'Translation: Hello the world\n' +
    'Now do the same for the image. If there is truly no text, output: NO_TEXT';

  const captureAndTranslate = useCallback(async () => {
    const cam = captureRef.current;
    if (!cam?.isCapturing) { await startCamera(); return; }
    setProcessing(true);
    setError(null);
    const t0 = performance.now();

    try {
      if (vlmLoader.state !== 'ready') {
        const ok = await vlmLoader.ensure();
        if (!ok) { setError('Failed to load VLM model'); setProcessing(false); return; }
      }

      const frame = cam.captureFrame(CAPTURE_DIM);
      if (!frame) { setError('Failed to capture image'); setProcessing(false); return; }

      const bridge = VLMWorkerBridge.shared;
      if (!bridge.isModelLoaded) throw new Error('VLM model not loaded in worker');

      const ocrResult = await Promise.race([
        bridge.process(frame.rgbPixels, frame.width, frame.height, VLM_PROMPT, { maxTokens: 300, temperature: 0.1 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Image processing timed out. Please try again.')), 90_000)
        ),
      ]);
      const text = ocrResult.text.trim();

      if (!text || text === 'NO_TEXT' || text.toLowerCase().includes('no_text') || text.toLowerCase().includes('no text') || text.toLowerCase().includes('i cannot')) {
        setError('No readable text detected. Try better lighting, move closer, or ensure text fills the frame.'); return;
      }

      handleVLMResult(text, t0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('memory access') || msg.includes('RuntimeError') ? 'Memory error — please try again.' : msg);
    } finally {
      setProcessing(false);
    }
  }, [startCamera, vlmLoader, handleVLMResult]);

  // ------------------------------------------------------------------
  // Image File Upload
  // ------------------------------------------------------------------
  const handleImageFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Please upload a JPEG, PNG, WebP, or GIF file'); return;
    }
    if (file.size > 10 * 1024 * 1024) { setError('Image too large (max 10MB)'); return; }
    setUploadedImageFile(file);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => setUploadedImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const processUploadedImage = useCallback(async () => {
    if (!uploadedImageFile || !uploadedImagePreview) return;
    setProcessing(true);
    setError(null);
    const t0 = performance.now();

    try {
      if (vlmLoader.state !== 'ready') {
        const ok = await vlmLoader.ensure();
        if (!ok) { setError('Failed to load VLM model'); setProcessing(false); return; }
      }

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = uploadedImagePreview;
      });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to create canvas context');

      let width = img.width;
      let height = img.height;
      const maxDim = Math.max(width, height);
      if (maxDim > CAPTURE_DIM) { const s = CAPTURE_DIM / maxDim; width = Math.floor(width * s); height = Math.floor(height * s); }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height);
      const rgbPixels = new Uint8Array(width * height * 3);
      for (let i = 0; i < imageData.data.length / 4; i++) {
        rgbPixels[i * 3] = imageData.data[i * 4];
        rgbPixels[i * 3 + 1] = imageData.data[i * 4 + 1];
        rgbPixels[i * 3 + 2] = imageData.data[i * 4 + 2];
      }

      const bridge = VLMWorkerBridge.shared;
      if (!bridge.isModelLoaded) throw new Error('VLM model not loaded in worker');

      const ocrResult = await Promise.race([
        bridge.process(rgbPixels, width, height, VLM_PROMPT, { maxTokens: 300, temperature: 0.1 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Image processing timed out. Please try again.')), 90_000)
        ),
      ]);
      const text = ocrResult.text.trim();

      if (!text || text === 'NO_TEXT' || text.toLowerCase().includes('no_text') || text.toLowerCase().includes('no text') || text.toLowerCase().includes('i cannot')) {
        setError('No readable text detected. Try a clearer photo with better lighting.'); return;
      }

      handleVLMResult(text, t0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('memory access') || msg.includes('RuntimeError') ? 'Memory error — please try again.' : msg);
    } finally {
      setProcessing(false);
    }
  }, [uploadedImageFile, uploadedImagePreview, vlmLoader, handleVLMResult]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const getCurrentLoader = () => {
    switch (inputMode) {
      case 'text':   return { loader: llmLoader, label: 'LLM' };
      case 'speech': return { loader: sttLoader, label: 'STT (Speech-to-Text)' };
      case 'image':  return { loader: vlmLoader, label: 'VLM (Vision)' };
    }
  };
  const { loader, label } = getCurrentLoader();

  return (
    <div className="tab-panel translator-panel">
      <ModelBanner state={loader.state} progress={loader.progress} error={loader.error} onLoad={loader.ensure} label={label} />

      {/* Input Mode Selector */}
      <div className="mode-selector">
        <button className={`mode-btn ${inputMode === 'text' ? 'active' : ''}`} onClick={() => switchTab('text')} disabled={processing}>📝 Text</button>
        <button className={`mode-btn ${inputMode === 'speech' ? 'active' : ''}`} onClick={() => switchTab('speech')} disabled={processing}>🎤 Speech</button>
        <button className={`mode-btn ${inputMode === 'image' ? 'active' : ''}`} onClick={() => switchTab('image')} disabled={processing}>📷 Image</button>
      </div>

      {/* Text Input Mode */}
      {inputMode === 'text' && (
        <div className="input-section">

          {/* Supported languages box */}
          <div className="lang-support-box">
            <div className="lang-support-title">📝 Supported Text Languages</div>
            <div className="lang-chips">
              {TEXT_SUPPORTED_LANGUAGES.map((lang) => (
                <span key={lang} className="lang-chip lang-chip--supported">{lang}</span>
              ))}
            </div>
            <p className="lang-support-note">
              Paste or type text in any of the above languages and it will be translated to English.
            </p>
          </div>

          <textarea className="text-input" placeholder="Enter text in any language..." value={textInput} onChange={(e) => setTextInput(e.target.value)} disabled={processing} rows={5} />
          <button className="btn btn-primary" onClick={handleTextTranslate} disabled={!textInput.trim() || processing}>
            {processing ? 'Translating...' : 'Translate to English'}
          </button>
        </div>
      )}

      {/* Speech Input Mode */}
      {inputMode === 'speech' && (
        <div className="input-section">

          {/* Supported languages box */}
          <div className="lang-support-box">
            <div className="lang-support-title">🎤 Supported Speech Languages</div>
            <div className="lang-chips">
              {SPEECH_SUPPORTED_LANGUAGES.map((lang) => (
                <span key={lang} className="lang-chip lang-chip--supported">{lang}</span>
              ))}
            </div>
            <p className="lang-support-note">
              The on-device speech model (Whisper Tiny) only recognises English audio.
              For other languages, use the <strong>Text</strong> or <strong>Image</strong> tab.
              Detecting a non-English language will show an error.
            </p>
          </div>

          <div className="method-selector">
            <button className={`method-btn ${speechInputMethod === 'record' ? 'active' : ''}`} onClick={() => setSpeechInputMethod('record')} disabled={processing || isRecording}>🎤 Record Audio</button>
            <button className={`method-btn ${speechInputMethod === 'upload' ? 'active' : ''}`} onClick={() => setSpeechInputMethod('upload')} disabled={processing || isRecording}>📁 Upload File</button>
          </div>

          {speechInputMethod === 'record' ? (
            <div className="speech-recorder">
              {!isRecording ? (
                <button className="btn btn-primary record-btn" onClick={startRecording} disabled={processing}>🎤 Start Recording</button>
              ) : (
                <div className="recording-active">
                  <div className="recording-indicator"><span className="recording-dot"></span>Recording... {recordingTime}s</div>
                  <button className="btn btn-stop" onClick={stopRecording}>⏹ Stop & Translate</button>
                </div>
              )}
              {processing && <p className="processing-text">Processing audio...</p>}
            </div>
          ) : (
            <div className="file-upload-section">
              <input ref={audioFileInputRef} type="file" accept="audio/wav,audio/mp3,audio/mpeg,audio/ogg,audio/webm" onChange={handleAudioFileSelect} style={{ display: 'none' }} />
              <button className="btn btn-primary" onClick={() => audioFileInputRef.current?.click()} disabled={processing}>📁 Choose Audio File</button>
              {uploadedAudioFile && (
                <div className="file-info">
                  <p className="file-name">📄 {uploadedAudioFile.name}</p>
                  <p className="file-size">{(uploadedAudioFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                  <button className="btn btn-primary" onClick={processUploadedAudio} disabled={processing}>{processing ? 'Processing...' : 'Translate Audio'}</button>
                </div>
              )}
              <p className="upload-hint">Supported formats: WAV, MP3, OGG, WebM (Max 50MB)</p>
            </div>
          )}
        </div>
      )}

      {/* Image Input Mode */}
      {inputMode === 'image' && (
        <div className="input-section">

          {/* Supported languages box */}
          <div className="lang-support-box">
            <div className="lang-support-title">📷 Supported Image Languages</div>
            <div className="lang-chips">
              {IMAGE_SUPPORTED_LANGUAGES.map((lang) => (
                <span key={lang} className="lang-chip lang-chip--supported">{lang}</span>
              ))}
            </div>
            <p className="lang-support-note">
              Text in any of the above scripts will be read and translated to English.
              Detecting any other language will show an error.
            </p>
          </div>

          <div className="method-selector">
            <button className={`method-btn ${imageInputMethod === 'camera' ? 'active' : ''}`} onClick={() => setImageInputMethod('camera')} disabled={processing}>📷 Use Camera</button>
            <button className={`method-btn ${imageInputMethod === 'upload' ? 'active' : ''}`} onClick={() => setImageInputMethod('upload')} disabled={processing}>📁 Upload Image</button>
          </div>

          {imageInputMethod === 'camera' ? (
            <>
              <div className="image-capture">
                {!cameraActive && (<div className="empty-state"><h3>📷 Camera Preview</h3><p>Point at text in any supported language</p></div>)}
                <div ref={videoMountRef} />
              </div>
              <div className="image-actions">
                {!cameraActive
                  ? <button className="btn btn-primary" onClick={startCamera}>Start Camera</button>
                  : <button className="btn btn-primary" onClick={captureAndTranslate} disabled={processing}>{processing ? 'Processing...' : '📸 Capture & Translate'}</button>
                }
              </div>
            </>
          ) : (
            <div className="file-upload-section">
              <input ref={imageFileInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/gif" onChange={handleImageFileSelect} style={{ display: 'none' }} />
              <button className="btn btn-primary" onClick={() => imageFileInputRef.current?.click()} disabled={processing}>📁 Choose Image File</button>
              {uploadedImageFile && uploadedImagePreview && (
                <div className="file-info">
                  <div className="image-preview"><img src={uploadedImagePreview} alt="Uploaded" /></div>
                  <p className="file-name">📄 {uploadedImageFile.name}</p>
                  <p className="file-size">{(uploadedImageFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                  <button className="btn btn-primary" onClick={processUploadedImage} disabled={processing}>{processing ? 'Processing...' : 'Extract & Translate Text'}</button>
                </div>
              )}
              <p className="upload-hint">Supported formats: JPEG, PNG, WebP, GIF (Max 10MB)</p>
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="translation-result error-result">
          <span className="error-text">❌ {error}</span>
        </div>
      )}

      {/* Translation Result */}
      {result && !error && (
        <div className="translation-result">
          <div className="result-section">
            <h4>Original {result.detectedLanguage && `(${result.detectedLanguage})`}</h4>
            <p className="original-text">{result.originalText}</p>
          </div>
          <div className="result-divider">⬇</div>
          <div className="result-section">
            <h4>English Translation</h4>
            <p className="translated-text">{result.translatedText}</p>
          </div>
          <div className="message-stats">Processed in {(result.processingTimeMs / 1000).toFixed(2)}s</div>
        </div>
      )}
    </div>
  );
}
