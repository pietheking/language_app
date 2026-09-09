# Translator

Plain HTML/CSS/JavaScript frontend with a Node.js backend with PostgreSQL storage. Node 22 or newer is required.

## Run

1. Open `backend/.env` and paste your Google AI Studio key after `GEMINI_API_KEY=`. If the file is absent, copy `backend/.env.example` to `backend/.env`.
2. Run:

   ```powershell
   cd backend
   npm start
   ```

3. Open http://127.0.0.1:3000 (the explicit address avoids conflicts with apps bound to IPv6 localhost). Use the server URL rather than opening the HTML file directly or using Live Server.

Run `npm install` in `backend` to install the PostgreSQL driver. Set `DATABASE_URL` and run `npm run db:migrate` before saving translations. See [PostgreSQL setup](backend/POSTGRESQL.md). Run `npm test` in `backend` for mocked-provider integration tests.

## Models and cost

Translation and audio transcription default to `gemini-3.5-flash-lite`. Cloud playback uses `gemini-2.5-flash-preview-tts`; an installed browser voice is preferred when available. Both defaults have a free tier in Google's published pricing. Obtain a key at https://aistudio.google.com/apikey and use a free-tier project without paid billing to avoid charges. Availability and quotas vary by account/region and can change. The app does not enable billing or switch to paid fallback models.

See https://ai.google.dev/gemini-api/docs/pricing and https://ai.google.dev/gemini-api/docs/speech-generation. Model names can be changed in `.env`. The app limits provider calls to 200/day by default, but this does not guarantee staying within provider quotas. Quota errors appear in the UI. Google may use free-tier content to improve its products; do not send confidential content without reviewing its terms.

## Features

- Translation, auto-detection, debounced typing, consistent language menus, swapping, clear and copy.
- Microphone recording with permission, automatic stop after 60 seconds, and server transcription. Requires localhost or HTTPS and a browser with MediaRecorder.
- Read source or translated text aloud. Cloud TTS is a preview service. Igbo, Yoruba and Hausa playback requires an installed matching device voice; the app reports unsupported playback clearly. Translation/transcription quality for these languages may vary.
- Save up to 100 translations per anonymous browser in PostgreSQL, load them, or delete them. A private cookie identifies the browser; clearing it loses access to its records.
- Text and recordings are sent to Google for processing. Only explicitly saved text and translations are persisted in PostgreSQL; recordings are not stored.

## API

| Route | Request | Response |
| --- | --- | --- |
| `GET /api/health` | None | `{status, configured}` |
| `POST /api/translate` | JSON `{text, source, target}` | `{translation, detectedSource}` |
| `POST /api/transcribe` | Multipart `audio` file and optional `source` | `{text}` |
| `POST /api/speak` | JSON `{text, lang}` | WAV audio |

Supported language codes: `en`, `es`, `fr`, `de`, `pt`, `it`, `ja`, `ig`, `yo`, `ha`. `auto` is accepted for source/transcription/speech, never translation target. Text input is limited to 5000 UTF-16 code units; audio requests to 5 MiB. Errors return JSON `{error}`.

## Security and deployment

API keys stay server-side in the ignored `.env`. Static serving uses an explicit frontend asset allowlist. The backend validates request types, sizes and language codes, applies per-IP throttling, caps concurrent model requests and daily usage, sets provider timeouts and security headers, and rejects foreign browser origins. Rendered output uses textContent. The PostgreSQL driver (`pg`) is the runtime dependency.

By default the server binds only to `127.0.0.1`. For deployment set `HOST`, `PORT`, and `APP_ORIGIN` to the intended host/port and exact public HTTPS origin. Use an HTTPS reverse proxy with request limits and HSTS. Forwarding headers are deliberately not trusted, so proxied users share the proxy's rate bucket. This app has no accounts: the public API would be available to anyone, and origin checks do not authenticate non-browser clients. Add authentication or restrict access at the proxy for a private deployment. Limits are process-local and reset on restart; multi-instance deployments need shared limits. Never expose `.env` through another web server.

## Verification limits

Automated tests use synthetic provider responses and audio fixtures. Live translation, WAV speech generation, and transcription of the generated audio were verified with the configured key. Browser translation, copy, save, clear, and restore were also verified. Physical microphone capture and OS voice behavior still require testing on your device. Check translation, change input during a pending request, clear, swap, record/stop, both playback buttons, copy, save/reload/delete, and quota/missing-key errors.

## Learning path

Start with the walkthrough comment in frontend/script.js, then follow translate() into api(). In backend/server.js, follow the translation route through jsonBody(), textInput(), language(), and generate(). Return to render() to see how the result becomes safe visible text.

Comments explain the reasons behind validation, dependency injection, request revisions, debouncing, audio headers, microphone cleanup, and database storage. The test files demonstrate expected success and failure behavior without sending requests to Google. Gemini 2.5 Flash-Lite returned a retirement error for this account, so the default now uses the available free-tier Gemini 3.5 Flash-Lite model.
