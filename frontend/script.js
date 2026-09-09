/**
 * FRONTEND WALKTHROUGH
 * Events read the form, call our backend, and render plain text.
 * Example: Translate -> POST /api/translate -> render the returned translation.
 * This function wrapper keeps our state out of the global window namespace.
 */
(() => {
  const languages = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    pt: "Portuguese",
    it: "Italian",
    ja: "Japanese",
    ig: "Igbo",
    yo: "Yoruba",
    ha: "Hausa",
  };
  // A small shortcut for finding an element by its HTML id.
  const $ = (id) => document.getElementById(id);
  const source = $("sourceText"),
    from = $("sourceLang"),
    to = $("targetLang");
  // revision identifies the current input. Old async responses must match it
  // before changing the screen; speech has its own independent revision.
  let timer,
    controller,
    revision = 0,
    result = null,
    recorder,
    stream,
    recordTimer,
    recordingBusy = false,
    audio,
    audioUrl,
    speechRevision = 0;
  // status displays a message in the status bar, optionally marking it as an error.
  const status = (message, error = false) => {
    $("statusText").textContent = message;
    $("statusMsg").classList.toggle("is-error", error);
  };
  // textContent displays model output literally, even if it contains HTML.
  // This prevents output such as <script> from becoming executable markup.
  function render(value) {
    result = value;
    $("resultText").textContent =
      value?.translation || "Your translation will appear here.";
    $("resultText").classList.toggle("is-empty", !value);
    ["copyBtn", "saveBtn", "playBtn"].forEach(
      (id) => ($(id).disabled = !value),
    );
  }
  function loading(value) {
    $("translateBtn").disabled = value;
    $("translateBtnLabel").textContent = value ? "Translating…" : "Translate";
    $("resultText").classList.toggle("is-loading", value);
    $("resultText").setAttribute("aria-busy", String(value));
  }
  // Blob URLs hold browser memory. Release them when playback stops.
  function stopSpeech() {
    speechRevision++;
    window.speechSynthesis?.cancel();
    if (audio) {
      audio.pause();
      audio = null;
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
  }
  // Example: clearing the input while a request runs must keep the result empty.
  // Abort reduces wasted work; revision also rejects a response already arriving.
  function invalidate() {
    clearTimeout(timer);
    controller?.abort();
    revision++;
    loading(false);
    render(null);
    stopSpeech();
    $("charCount").textContent = source.value.length;
  }
  // Same-origin URLs send requests to the server that delivered this page.
  // The server, not this browser, adds the secret Gemini API key.
  async function api(path, options) {
    const response = await fetch(`/api/${path}`, {
      ...options,
      signal: options.signal || AbortSignal.timeout(55000),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status}).`);
    }
    return response;
  }
  // Snapshot the input before awaiting: the user may type while we wait.
  async function translate() {
    invalidate();
    const text = source.value.trim(),
      sourceLang = from.value,
      target = to.value;
    if (!text) return status("Ready");
    const version = revision;
    controller = new AbortController();
    // Capture this request controller: an older timeout must not abort a newer call.
    const requestController = controller;
    const timeout = setTimeout(() => requestController.abort(), 55000);
    loading(true);
    status("Translating…");
    try {
      const response = await api("translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source: sourceLang, target }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (version !== revision) return;
      render({ ...data, text, source: sourceLang, target });
      status("Translation ready");
    } catch (error) {
      if (version === revision)
        status(
          error.name === "AbortError"
            ? "Request timed out. Try again."
            : error.message,
          true,
        );
    } finally {
      clearTimeout(timeout);
      if (version === revision) loading(false);
    }
  }
  // Debounce: typing resets a 1.2-second timer instead of calling on every key.
  function changed() {
    invalidate();
    stopRecording();
    status("Ready");
    if (source.value.trim()) timer = setTimeout(translate, 1200);
  }
  // Prefer a matching installed voice, then ask the backend for cloud audio.
  // Missing language support produces a visible error rather than a wrong voice.
  async function speak(text, lang) {
    if (!text.trim()) return;
    stopSpeech();
    const version = speechRevision;
    const voice = window.speechSynthesis
      ?.getVoices()
      .find((v) => v.lang.split("-")[0] === lang);
    if (voice) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.onend = () => {
        if (version === speechRevision) status("Ready");
      };
      utterance.onerror = () => {
        if (version === speechRevision)
          status("Could not play device audio.", true);
      };
      window.speechSynthesis.speak(utterance);
      status("Playing…");
      return;
    }
    status("Loading audio…");
    try {
      const response = await api("speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang }),
      });
      const blob = await response.blob();
      if (version !== speechRevision) return;
      audioUrl = URL.createObjectURL(blob);
      audio = new Audio(audioUrl);
      audio.onended = () => {
        stopSpeech();
        status("Ready");
      };
      audio.onerror = () => {
        stopSpeech();
        status("Could not play audio.", true);
      };
      await audio.play();
      if (version === speechRevision) status("Playing…");
    } catch (error) {
      if (version === speechRevision) {
        stopSpeech();
        status(error.message, true);
      }
    }
  }
  // Stopping MediaRecorder is not enough: stop tracks to release the microphone.
  function stopRecording() {
    clearTimeout(recordTimer);
    if (recorder?.state === "recording") recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
  }
  // First click asks permission and starts recording; the next click stops it.
  // Permission itself is async, so check whether the input changed while waiting.
  async function mic() {
    if (recorder?.state === "recording") return stopRecording();
    if (recordingBusy) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
      return status(
        "Recording requires a supported browser on localhost or HTTPS.",
        true,
      );
    recordingBusy = true;
    $("micBtn").disabled = true;
    const initialRevision = revision;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (initialRevision !== revision) {
        stream.getTracks().forEach((track) => track.stop());
        recordingBusy = false;
        $("micBtn").disabled = false;
        return;
      }
      stopSpeech();
      controller?.abort();
      clearTimeout(timer);
      revision++;
      loading(false);
      const version = revision,
        lang = from.value;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType)
        throw new Error("This browser cannot record a supported audio format.");
      recorder = new MediaRecorder(stream, { mimeType });
      const chunks = [];
      let size = 0,
        recordingFailed = false;
      recorder.ondataavailable = (event) => {
        chunks.push(event.data);
        size += event.data.size;
        if (size > 4 * 1024 * 1024) stopRecording();
      };
      recorder.onerror = () => {
        recordingFailed = true;
        stopRecording();
        status("Recording failed. Please try again.", true);
      };
      // Assemble the chunks only after recording finishes. FormData sets its own
      // multipart boundary, so do not manually set the Content-Type header.
      recorder.onstop = async () => {
        clearTimeout(recordTimer);
        stream?.getTracks().forEach((track) => track.stop());
        $("micBtn").classList.remove("is-active");
        $("micBtn").setAttribute("aria-pressed", "false");
        $("micBtn").disabled = true;
        try {
          if (version !== revision || recordingFailed) return;
          if (!size || size > 4 * 1024 * 1024)
            throw new Error(
              "Recording is empty or too large. Try a shorter clip.",
            );
          status("Transcribing…");
          const form = new FormData();
          form.append(
            "audio",
            new Blob(chunks, { type: mimeType }),
            mimeType.includes("mp4") ? "recording.mp4" : "recording.webm",
          );
          form.append("source", lang);
          const response = await api("transcribe", {
            method: "POST",
            body: form,
          });
          const data = await response.json();
          if (version !== revision) return;
          source.value = data.text;
          changed();
          if (!data.text) status("No speech detected. Try again.");
        } catch (error) {
          if (version === revision) status(error.message, true);
        } finally {
          recordingBusy = false;
          $("micBtn").disabled = false;
        }
      };
      recorder.start(1000);
      $("micBtn").disabled = false;
      $("micBtn").classList.add("is-active");
      $("micBtn").setAttribute("aria-pressed", "true");
      status("Recording… click the microphone to stop (60 sec max)");
      recordTimer = setTimeout(stopRecording, 60000);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      recordingBusy = false;
      $("micBtn").disabled = false;
      status(
        error.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : error.message,
        true,
      );
    }
  }
  // Content lives in PostgreSQL. The browser sends its HttpOnly owner cookie
  // automatically; no database credentials or owner identifiers enter this script.
  let savedRevision = 0;
  async function savedItems() {
    const response = await api("saved-translations", {});
    return (await response.json()).items;
  }
  async function showSaved() {
    const version = ++savedRevision;
    const list = $("savedList");
    try {
      const items = await savedItems();
      if (version !== savedRevision) return;
      list.replaceChildren();
      if (!items.length) list.textContent = "No saved translations yet.";
      items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "saved-item";
        const label = document.createElement("p");
        label.textContent =
          (languages[item.source] || "Detected") +
          " → " +
          languages[item.target] +
          ": " +
          item.translation;
        const restore = document.createElement("button");
        restore.textContent = "Load";
        restore.type = "button";
        restore.onclick = () => {
          invalidate();
          stopRecording();
          source.value = item.text;
          from.value = item.source;
          to.value = item.target;
          $("charCount").textContent = source.value.length;
          render(item);
          status("Saved translation loaded");
        };
        const remove = document.createElement("button");
        remove.textContent = "Delete";
        remove.type = "button";
        remove.onclick = async () => {
          remove.disabled = true;
          try {
            await api("saved-translations/" + item.id, { method: "DELETE" });
            await showSaved();
          } catch (error) {
            remove.disabled = false;
            status(error.message, true);
          }
        };
        row.append(label, restore, remove);
        list.append(row);
      });
    } catch (error) {
      if (version !== savedRevision) return;
      list.replaceChildren();
      list.textContent = error.message;
    }
  }
  // Both menus share the same languages so swapping never selects a missing option.
  for (const select of [from, to]) {
    const selected = select.value;
    select.replaceChildren();
    if (select === from) select.add(new Option("Detect language", "auto"));
    for (const [code, name] of Object.entries(languages))
      select.add(new Option(name, code));
    select.value = selected;
    select.onchange = changed;
  }
  // Event wiring: each control delegates to a named behavior above.
  source.oninput = changed;
  $("translateBtn").onclick = translate;
  $("clearBtn").onclick = () => {
    source.value = "";
    invalidate();
    stopRecording();
    status("Ready");
    source.focus();
  };
  $("swapLangs").onclick = () => {
    const old = result,
      sourceLang = from.value === "auto" ? old?.detectedSource : from.value;
    if (!Object.hasOwn(languages, sourceLang))
      return status(
        "Translate first, or select a source language before swapping.",
        true,
      );
    const target = to.value;
    invalidate();
    from.value = target;
    to.value = sourceLang;
    if (old) source.value = old.translation.slice(0, 5000);
    changed();
  };
  $("copyBtn").onclick = async () => {
    if (result) {
      try {
        await navigator.clipboard.writeText(result.translation);
        status("Copied to clipboard");
      } catch {
        status(
          "Clipboard unavailable. Select the result and copy it manually.",
          true,
        );
      }
    }
  };
  $("saveBtn").onclick = async () => {
    if (!result) return;
    const snapshot = result;
    $("saveBtn").disabled = true;
    try {
      // Establish the cookie first even if the initial list request failed.
      await savedItems();
      await api("saved-translations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      await showSaved();
      status("Saved to PostgreSQL");
    } catch (error) {
      status(error.message, true);
    } finally {
      $("saveBtn").disabled = !result;
    }
  };
  $("playBtn").onclick = () => {
    if (result) speak(result.translation, result.target);
  };
  $("waveBtn").onclick = () =>
    speak(
      source.value,
      from.value === "auto" ? result?.detectedSource || "auto" : from.value,
    );
  $("micBtn").onclick = mic;
  window.addEventListener("pagehide", () => {
    invalidate();
    stopRecording();
  });
  window.speechSynthesis?.getVoices();
  render(null);
  showSaved();
  $("charCount").textContent = source.value.length;
  // A slow health check must not overwrite a newer user-action status message.
  const bootRevision = revision;
  api("health", {})
    .then((r) => r.json())
    .then((data) => {
      if (!data.configured && revision === bootRevision)
        status("Add your API key to backend/.env to enable translation.", true);
    })
    .catch(() => {
      if (revision === bootRevision)
        status(
          "Backend unavailable. Open this app through the Node server.",
          true,
        );
    });
})();
