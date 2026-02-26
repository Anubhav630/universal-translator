# Universal Translator - RunAnywhere Web App

A React + TypeScript web application demonstrating **on-device AI translation** in the browser using the [`@runanywhere/web`](https://www.npmjs.com/package/@runanywhere/web) SDK. Translate text, speech, and images from any language to English — all running locally via WebAssembly with **no server, no API key, 100% private**.

## Features

| Tab | What it does |
|-----|-------------|
| **🌐 Translator** | **Translate any language to English** using three input modes:<br>• **📝 Text**: Type or paste text in any language<br>• **🎤 Speech**: Record audio in any language and get English text<br>• **📷 Image**: Capture photos with text (signs, documents) for OCR + translation |
| **💬 Chat** | Stream text from an on-device LLM (LFM2 350M) |
| **📷 Vision** | Point your camera and describe what the VLM sees (LFM2-VL 450M) |
| **🎙️ Voice** | Speak naturally — VAD detects speech, STT transcribes, LLM responds, TTS speaks back |

## Universal Translator Capabilities

### 1. Text Translation
- Paste or type text in any language
- AI automatically detects the source language
- Translates to English with context preservation
- Uses LLM with specialized translation system prompt

### 2. Speech-to-Text Translation
- Record audio in any language
- On-device speech recognition (Whisper model)
- Automatic transcription + translation to English
- No audio data leaves your device

### 3. Image OCR + Translation
- Capture photos of text (signs, menus, documents)
- Vision Language Model extracts text from images
- Automatically translates detected text to English
- Perfect for travel, studying foreign documents

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Models are downloaded on first use and cached in the browser's Origin Private File System (OPFS).

## How It Works

```
@runanywhere/web (npm package)
  ├── WASM engine (llama.cpp, whisper.cpp, sherpa-onnx)
  ├── Model management (download, OPFS cache, load/unload)
  └── TypeScript API (TextGeneration, STT, TTS, VAD, VLM, VoicePipeline)
```

### Translation Architecture

**Text Mode:**
```typescript
LLM with specialized system prompt → Detect language + Translate to English
```

**Speech Mode:**
```typescript
Audio Recording → STT (Whisper) → Transcription → LLM Translation → English Text
```

**Image Mode:**
```typescript
Camera Capture → VLM (Vision Language Model) → OCR Text Extraction → LLM Translation → English Text
```

## Project Structure

```
src/
├── main.tsx              # React root
├── App.tsx               # Tab navigation (Translator | Chat | Vision | Voice)
├── runanywhere.ts        # SDK init + model catalog + VLM worker
├── workers/
│   └── vlm-worker.ts     # VLM Web Worker entry
├── hooks/
│   └── useModelLoader.ts # Shared model download/load hook
├── components/
│   ├── TranslatorTab.tsx  # Universal translator (NEW!)
│   ├── ChatTab.tsx        # LLM streaming chat
│   ├── VisionTab.tsx      # Camera + VLM inference
│   ├── VoiceTab.tsx       # Full voice pipeline
│   └── ModelBanner.tsx    # Download progress UI
└── styles/
    └── index.css          # Dark theme CSS with translator styles
```

## Models Used

The translator uses multiple AI models based on the input mode:

| Input Mode | Model | Size | Purpose |
|------------|-------|------|---------|
| Text | LFM2 350M Q4_K_M | ~250MB | Language detection + translation |
| Speech | Whisper Tiny English | ~105MB | Speech-to-text transcription |
| Speech | LFM2 350M Q4_K_M | ~250MB | Translation after transcription |
| Image | LFM2-VL 450M Q4_0 | ~500MB | Vision + OCR text extraction |
| Image | LFM2 350M Q4_K_M | ~250MB | Translation after OCR |

All models are:
- Downloaded once and cached permanently in browser storage (OPFS)
- Run entirely on-device via WebAssembly
- Private (no data sent to any server)

## Usage Tips

### Text Translation
- Works with any language (Spanish, French, Chinese, Arabic, etc.)
- Handles multiple paragraphs
- Preserves formatting and meaning

### Speech Translation
- Speak clearly for 3-10 seconds
- Works best in quiet environments
- Detects any spoken language automatically

### Image Translation
- Hold camera steady and ensure text is visible
- Works with signs, menus, documents, screenshots
- Best results with clear, well-lit text
- Text size should be readable on camera preview

## Adding Custom Models

Edit the `MODELS` array in `src/runanywhere.ts`:

```typescript
{
  id: 'my-custom-model',
  name: 'My Model',
  repo: 'username/repo-name',           // HuggingFace repo
  files: ['model.Q4_K_M.gguf'],         // Files to download
  framework: LLMFramework.LlamaCpp,
  modality: ModelCategory.Language,      // or Multimodal, SpeechRecognition, etc.
  memoryRequirement: 500_000_000,        // Bytes
}
```

Any GGUF model compatible with llama.cpp works for LLM/VLM. STT/TTS/VAD use sherpa-onnx models.

## Deployment

### Vercel

```bash
npm run build
npx vercel --prod
```

The included `vercel.json` sets the required Cross-Origin-Isolation headers.

### Netlify

Add a `_headers` file:

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: credentialless
```

### Any static host

Serve the `dist/` folder with these HTTP headers on all responses:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

## Browser Requirements

- Chrome 96+ or Edge 96+ (recommended: 120+)
- WebAssembly (required)
- SharedArrayBuffer (requires Cross-Origin Isolation headers)
- OPFS (for persistent model cache)
- Camera access (for image translation)
- Microphone access (for speech translation)

## Privacy & Security

All AI processing happens **locally in your browser**:
- ✅ No data sent to servers
- ✅ No API keys required
- ✅ No internet needed after initial model download
- ✅ All models cached locally in browser storage
- ✅ Audio and images never leave your device

## Documentation

- [RunAnywhere SDK Docs](https://docs.runanywhere.ai)
- [Web SDK Introduction](https://docs.runanywhere.ai/web/introduction)
- [npm package](https://www.npmjs.com/package/@runanywhere/web)
- [GitHub](https://github.com/RunanywhereAI/runanywhere-sdks)

## License

MIT
