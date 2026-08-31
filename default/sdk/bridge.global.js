var fb = (function () {
  'use strict';

  // src/bridge/Bridge.ts
  var Bridge = class {
    constructor() {
      this.nativeFb2k = this.getNativeFb2k();
      this._isAvailable = !!this.nativeFb2k;
      this.checkAvailability();
    }
    /**
     * Install or remove an instrumentation hook fired after every
     * {@link Bridge.invoke} call settles, including the mock-fallback
     * path. Useful for telemetry, logging, and per-method latency
     * tracking.
     *
     * Exceptions thrown by the hook are caught and discarded so
     * downstream observability code cannot break invoke callers. Pass
     * `undefined` to detach a previously installed hook.
     *
     * @param hook - Receives a {@link BridgeInvokeMetrics} snapshot per
     *               settled invoke, or `undefined` to detach.
     */
    setMetricsHook(hook) {
      this._metricsHook = hook;
    }
    /**
     * Dispatch a {@link BridgeInvokeMetrics} snapshot to the installed
     * hook. Exceptions thrown by the hook are surfaced via
     * `console.warn` (with the method name and the original error) and
     * then discarded so observability failures cannot destabilise the
     * invoke pipeline.
     */
    _emitMetrics(metrics) {
      const hook = this._metricsHook;
      if (!hook) return;
      try {
        hook(metrics);
      } catch (err) {
        try {
          console.warn(
            `[fb2k SDK] BridgeMetricsHook threw for "${metrics.method}":`,
            err
          );
        } catch {
        }
      }
    }
    /**
     * High-resolution monotonic timestamp in milliseconds, with a
     * `Date.now()` fallback for environments without `performance`.
     */
    _now() {
      return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    }
    /**
     * Resolve the native bridge handle from the global `window`.
     *
     * Returns the cached `window._nativeFb2k` alias when present,
     * otherwise the host-injected `window.fb2k` if it exposes an
     * `invoke` function. Returns `undefined` when running outside a
     * WebView2 host so callers can transparently fall back to the
     * mock path.
     */
    getNativeFb2k() {
      if (typeof window === "undefined") return void 0;
      if (window._nativeFb2k) return window._nativeFb2k;
      const candidate = window.fb2k;
      if (candidate && typeof candidate.invoke === "function") {
        window._nativeFb2k = candidate;
        return candidate;
      }
      return void 0;
    }
    /**
     * If the native bridge is missing but a WebView2 host is detected,
     * poll for late injection (the host may install `fb2k` after the
     * SDK loads). Polls 50 times at 100ms intervals (5 s budget).
     */
    checkAvailability() {
      if (this.nativeFb2k) return;
      if (typeof window === "undefined") return;
      const w = window;
      if (!w.chrome?.webview) return;
      let attempts = 0;
      const maxAttempts = 50;
      const poll = () => {
        this.nativeFb2k = this.getNativeFb2k();
        if (this.nativeFb2k) {
          this._isAvailable = true;
          if (this._readyResolve) this._readyResolve();
          return;
        }
        if (++attempts < maxAttempts) {
          setTimeout(poll, 100);
        }
      };
      setTimeout(poll, 100);
    }
    /**
     * Read-only availability flag, exposed indirectly via
     * `fb.isAvailable()` on the runtime aggregate object.
     */
    get isAvailable() {
      return this._isAvailable;
    }
    /**
     * Promise that resolves once the native bridge is reachable. Resolves
     * immediately if the host is already present; otherwise resolves when
     * {@link Bridge.checkAvailability} succeeds via late injection.
     */
    ready() {
      if (this._isAvailable) return Promise.resolve();
      if (!this._readyPromise) {
        this._readyPromise = new Promise((resolve) => {
          this._readyResolve = resolve;
        });
      }
      return this._readyPromise;
    }
    /**
     * Invoke a registered C++ API.
     *
     * @typeParam TResp - Expected response shape (caller-supplied so each
     *                    namespace can request the correct
     *                    `*Response` interface from `src/types/responses.ts`).
     * @param method - Canonical `<namespace>.<method>` API name in dot
     *                 notation (e.g. `playback.play`).
     * @param params - Parameter object; structure determined by the
     *                 registered C++ handler.
     * @returns Promise that resolves with `TResp`. In mock environments
     *          (no host) resolves with {@link MockInvokeResponse} cast
     *          to `TResp` after a 100ms delay.
     */
    async invoke(method, params) {
      const start = this._now();
      const native = this.getNativeFb2k();
      if (native) {
        try {
          const result = await native.invoke(method, params);
          this._emitMetrics({
            method,
            durationMs: this._now() - start,
            success: true,
            result
          });
          return result;
        } catch (error) {
          this._emitMetrics({
            method,
            durationMs: this._now() - start,
            success: false,
            error
          });
          throw error;
        }
      }
      return new Promise((resolve) => {
        setTimeout(() => {
          const stub = { mock: true, method };
          this._emitMetrics({
            method,
            durationMs: this._now() - start,
            success: true,
            result: stub
          });
          resolve(stub);
        }, 100);
      });
    }
    on(event2, handler) {
      const native = this.getNativeFb2k();
      if (native) {
        native.on(event2, handler);
        return () => this.off(event2, handler);
      }
      return () => {
      };
    }
    /**
     * Detach a previously registered handler. No-op when the host is
     * unavailable.
     */
    off(event2, handler) {
      const native = this.getNativeFb2k();
      if (native) {
        native.off(event2, handler);
      }
    }
    once(event2, handler) {
      const wrapper = (data) => {
        this.off(event2, wrapper);
        handler(data);
      };
      return this.on(event2, wrapper);
    }
  };
  var bridge = new Bridge();

  // src/bridge/state.ts
  var state = {
    volume: 0,
    isPlaying: false,
    currentTrack: null,
    position: 0
  };
  bridge.on("playback:stateChanged", (data) => {
    if (data.state !== void 0) {
      state.isPlaying = data.state === "playing";
    }
    if (data.position !== void 0) {
      state.position = data.position;
    }
  });
  bridge.on("playback:trackChanged", (data) => {
    state.currentTrack = data;
    state.isPlaying = true;
  });
  bridge.on("playback:stopped", () => {
    state.isPlaying = false;
    state.position = 0;
  });
  bridge.on("playback:volumeChanged", (data) => {
    if (data.volume !== void 0) {
      state.volume = data.volume;
    }
  });
  bridge.on("playback:time", (data) => {
    if (data.position !== void 0) {
      state.position = data.position;
    }
  });

  // src/bridge/namespaces/artwork.ts
  var artwork = {
    getCurrent: (type) => bridge.invoke("artwork.getCurrent", { type }),
    getByPath: (path, type) => bridge.invoke("artwork.getByPath", { path, type }),
    getForTrack: (path, type, options) => bridge.invoke("artwork.getForTrack", {
      path,
      type,
      ...options || {}
    }),
    /**
     * Resolve a `fb2k://` URL for the currently playing track suitable
     * for direct `<img src>` consumption.
     *
     * The resolved URL is returned in the `dataUrl` field of the
     * response envelope (see {@link ArtworkGetFb2kUrlResponse}).
     */
    getFb2kUrl: (type, options) => bridge.invoke("artwork.getFb2kUrl", {
      type,
      ...options || {}
    }),
    /**
     * Resolve a `fb2k://` URL for the track at `path` suitable for
     * direct `<img src>` consumption.
     *
     * The resolved URL is returned in the `dataUrl` field of the
     * response envelope (see {@link ArtworkGetFb2kUrlByPathResponse}).
     */
    getFb2kUrlByPath: (path, type, options) => bridge.invoke(
      "artwork.getFb2kUrlByPath",
      {
        path,
        type,
        ...options || {}
      }
    ),
    /**
     * Append `?maxSize=N` (or `&maxSize=N`) to a `fb2k://` artwork URL.
     * Returns the original URL untouched when `maxSize` is missing,
     * non-positive, or the URL is empty.
     */
    withMaxSize: (url, maxSize) => {
      if (!url || !maxSize || maxSize <= 0) return url;
      const sep = url.includes("?") ? "&" : "?";
      return url + sep + "maxSize=" + encodeURIComponent(String(maxSize));
    },
    getAvailableArtwork: (path) => bridge.invoke(
      "artwork.getAvailableArtwork",
      { ...path ? { path } : {} }
    ),
    getAvailableTypes: () => bridge.invoke("artwork.getAvailableTypes"),
    getBatch: (paths) => bridge.invoke("artwork.getBatch", { paths }),
    getByPlaylistItem: (playlist2, index, type) => bridge.invoke("artwork.getByPlaylistItem", {
      playlist: playlist2,
      index,
      ...type ? { type } : {}
    }),
    /**
     * Batch variant of {@link getFb2kUrlByPath}. Accepts either bare
     * paths or `ArtworkBatchItem` objects with per-track overrides.
     * Returns the full `{ artworks: ArtworkBatchEntry[] }` envelope so
     * callers can map per-row availability and error reasons.
     *
     * Aligns the SDK signature with the C++ handler
     * `ArtworkGetFb2kUrlByPathBatch` which accepts `items[]` or
     * `paths[]` plus batch-wide `type` / `maxSize`.
     */
    getFb2kUrlByPathBatch: (items, opts) => bridge.invoke(
      "artwork.getFb2kUrlByPathBatch",
      {
        // C++ accepts either `paths` (string[]) or `items` (object[]).
        // We forward whichever the caller actually passed for clarity.
        ...items.length > 0 && typeof items[0] === "string" ? { paths: items } : { items },
        ...opts?.type ? { type: opts.type } : {},
        ...opts?.maxSize != null ? { maxSize: opts.maxSize } : {}
      }
    ),
    getFolderImages: (directory) => bridge.invoke("artwork.getFolderImages", {
      directory
    }),
    getLyrics: (path) => bridge.invoke("artwork.getLyrics", { path }),
    getMetadata: (path) => bridge.invoke("artwork.getMetadata", { path })
  };

  // src/bridge/namespaces/audio.ts
  function newSubscriptionId() {
    if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return "spectrum_" + Date.now().toString() + "_" + Math.random().toString(36).slice(2);
  }
  var audio = {
    /**
     * Subscribe to a real-time spectrum stream. Returns an unsubscribe
     * callback that detaches the listener and tells the host to tear
     * down the underlying compute pipeline.
     */
    subscribeSpectrum: (callback, options = {}) => {
      const subscriptionId = newSubscriptionId();
      const eventName = options.event || "audio:spectrum";
      bridge.invoke("audio.subscribeSpectrum", {
        subscriptionId,
        fftSize: options.fftSize || 1024,
        fps: options.fps || 30,
        bands: options.bands || 48,
        event: eventName
      });
      const unsub = bridge.on(eventName, callback);
      return () => {
        unsub();
        bridge.invoke("audio.unsubscribeSpectrum", { subscriptionId });
      };
    },
    /**
     * Subscribe to the raw audio-stream callback channel.
     *
     * @deprecated Host-side stream capture is **not implemented yet**:
     * the C++ handler at `src/api/AudioApi.cpp:AudioSubscribeStream`
     * currently returns
     * `{success: false, error: "Stream capture requires
     * playback_stream_capture integration"}` without ever emitting an
     * `audio:stream` event. The returned unsubscribe is still wired
     * up so callers can fail gracefully, but the supplied `callback`
     * **will never fire** until the host integration lands. The SDK
     * surfaces a one-shot `console.warn` from the underlying
     * `bridge.invoke` resolution to make this state visible.
     *
     * Track the integration status before re-enabling consumer code.
     */
    subscribeStream: (callback, options = {}) => {
      bridge.invoke("audio.subscribeStream", options).then((resp) => {
        if (resp && resp.success === false) {
          const detail = resp.error ? ` (${resp.error})` : "";
          console.warn(
            "[fb-sdk] audio.subscribeStream: host returned success=false; the callback will never fire" + detail + "."
          );
        }
      }).catch(() => {
      });
      const unsub = bridge.on("audio:stream", callback);
      return () => {
        unsub();
        bridge.invoke("audio.unsubscribeStream");
      };
    },
    /** @deprecated Pairs with the deprecated {@link audio.subscribeStream}. */
    unsubscribeStream: () => bridge.invoke("audio.unsubscribeStream"),
    /**
     * Single-shot poll of the spectrum buffer; requires an active
     * {@link audio.subscribeSpectrum} subscription on the host side.
     */
    getSpectrum: (options = {}) => bridge.invoke("audio.getSpectrum", options),
    /**
     * Short-window waveform of the current playback stream. Accepts
     * either `(opts)` (preferred) or `(path, opts)` (deprecated form;
     * the path is ignored because the host always uses the active
     * stream).
     */
    getWaveform: (pathOrOpts, opts) => {
      if (typeof pathOrOpts === "string") {
        return bridge.invoke(
          "audio.getWaveform",
          opts || {}
        );
      }
      return bridge.invoke(
        "audio.getWaveform",
        pathOrOpts || {}
      );
    },
    getOutputInfo: () => bridge.invoke("audio.getOutputInfo"),
    getStreamInfo: () => bridge.invoke("audio.getStreamInfo"),
    analyzeBPM: (path, opts = {}) => bridge.invoke("audio.analyzeBPM", { path, ...opts }),
    isVisualizationAvailable: () => bridge.invoke("audio.isVisualizationAvailable"),
    setChannelMode: (mode) => bridge.invoke("audio.setChannelMode", { mode }),
    /** @deprecated Use {@link audio.generateFullWaveform}. */
    generateWaveform: (path, opts) => bridge.invoke(
      "audio.generateWaveform",
      { path, ...opts || {} }
    ),
    getSpectrumDebugState: () => bridge.invoke("audio.getSpectrumDebugState"),
    /**
     * Generate a full-track waveform. Resolves synchronously on cache
     * hit; otherwise awaits the
     * `audio:fullWaveformReady` / `audio:fullWaveformFailed` events
     * with a client-side timeout (default 60 s, override via
     * `opts.timeout`).
     */
    generateFullWaveform: async (path, opts = {}) => {
      const result = await bridge.invoke(
        "audio.generateFullWaveform",
        { path, ...opts }
      );
      if (result?.status === "ready") return result;
      if (result?.success === false) return result;
      if (result?.status === "pending") {
        const timeoutMs = opts.timeout ?? 6e4;
        return new Promise((resolve, reject) => {
          const taskId = result.taskId;
          let timer = null;
          const cleanup = () => {
            offReady();
            offFail();
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
          };
          const offReady = bridge.on(
            "audio:fullWaveformReady",
            (e) => {
              if (e?.taskId === taskId) {
                cleanup();
                resolve({
                  success: true,
                  status: "ready",
                  ...e
                });
              }
            }
          );
          const offFail = bridge.on(
            "audio:fullWaveformFailed",
            (e) => {
              if (e?.taskId === taskId) {
                cleanup();
                reject(e);
              }
            }
          );
          if (timeoutMs > 0) {
            timer = setTimeout(() => {
              cleanup();
              reject({
                success: false,
                error: "TIMEOUT",
                message: "generateFullWaveform timed out after " + timeoutMs + "ms",
                taskId
              });
            }, timeoutMs);
          }
        });
      }
      return result;
    }
  };

  // src/bridge/namespaces/clipboard.ts
  var clipboard = {
    read: () => bridge.invoke("clipboard.read"),
    write: (text) => bridge.invoke("clipboard.write", { text }),
    writeHTML: (html, plainText) => bridge.invoke("clipboard.writeHTML", {
      html,
      ...plainText ? { plainText } : {}
    }),
    writeFiles: (paths) => bridge.invoke(
      "clipboard.writeFiles",
      { paths }
    )
  };

  // src/bridge/namespaces/config.ts
  var config = {
    getOutputDevices: () => bridge.invoke("config.getOutputDevices"),
    getOutputConfig: () => bridge.invoke("config.getOutputConfig"),
    setOutputDevice: (outputId, deviceId) => bridge.invoke("config.setOutputDevice", {
      outputId,
      deviceId
    }),
    /**
     * Set the output buffer length.
     *
     * Accepts either a single numeric argument (milliseconds, matching
     * the original `(ms)` signature) or an options object that lets
     * callers pick the unit explicitly:
     * - `milliseconds` — buffer in ms; the host divides by 1000.
     * - `bufferLength` — buffer in seconds (the host's native unit).
     *
     * If both fields are present the host prefers `milliseconds`. The
     * resolved buffer must fall within `[0.05, 2.0]` seconds; the host
     * rejects out-of-range values with an error envelope.
     *
     * @param value - Numeric milliseconds, **or** an options object
     *                with `milliseconds` and/or `bufferLength`.
     */
    setOutputBuffer: ((value) => {
      const opts = typeof value === "number" ? { milliseconds: value } : value;
      return bridge.invoke("config.setOutputBuffer", {
        ...opts.milliseconds != null ? { milliseconds: opts.milliseconds } : {},
        ...opts.bufferLength != null ? { bufferLength: opts.bufferLength } : {}
      });
    }),
    getAdvancedConfig: () => bridge.invoke("config.getAdvancedConfig"),
    getAdvancedConfigValue: (guid) => bridge.invoke(
      "config.getAdvancedConfigValue",
      { guid }
    ),
    setAdvancedConfigValue: (guid, value) => bridge.invoke("config.setAdvancedConfigValue", {
      guid,
      value
    }),
    resetAdvancedConfig: (guid) => bridge.invoke("config.resetAdvancedConfig", { guid }),
    getPreferencesPages: () => bridge.invoke("config.getPreferencesPages"),
    getPreferencesStandardGuids: () => bridge.invoke(
      "config.getPreferencesStandardGuids"
    ),
    getLibraryStatus: () => bridge.invoke("config.getLibraryStatus"),
    getLibraryFilePatterns: () => bridge.invoke(
      "config.getLibraryFilePatterns"
    ),
    showLibraryPreferences: () => bridge.invoke("config.showLibraryPreferences"),
    getComponents: () => bridge.invoke("config.getComponents"),
    getVersionInfo: () => bridge.invoke("config.getVersionInfo"),
    getDspPresets: () => bridge.invoke("config.getDspPresets"),
    getActiveDspPreset: () => bridge.invoke("config.getActiveDspPreset"),
    setActiveDspPreset: (index) => bridge.invoke("config.setActiveDspPreset", { index }),
    // === Portable config storage ===
    set: (key, value) => bridge.invoke("config.set", { key, value }),
    get: (key) => bridge.invoke("config.get", { key }),
    remove: (key) => bridge.invoke(
      "config.remove",
      { key }
    ),
    /**
     * Full snapshot of the portable-config cache. Returns the
     * `{ success, items, configs, count }` envelope; `items` and
     * `configs` are interchangeable aliases of the same map.
     */
    getAll: () => bridge.invoke("config.getAll"),
    export: () => bridge.invoke("config.export"),
    // === Cursor follow / playback follow / ReplayGain mode ===
    getCursorFollowPlayback: () => bridge.invoke("config.getCursorFollowPlayback"),
    getPlaybackFollowCursor: () => bridge.invoke("config.getPlaybackFollowCursor"),
    /**
     * Resolve the active ReplayGain source mode.
     *
     * The host returns the mode as an integer (`0` = none, `1` = track,
     * `2` = album, `3` = byPlaybackOrder). Use the
     * `REPLAYGAIN_SOURCE_MODE` constant dictionary exported alongside
     * the response type to compare against named entries:
     *
     *     const r = await config.getReplaygainMode();
     *     if (r.mode === REPLAYGAIN_SOURCE_MODE.track) { ... }
     *
     * The `value` field is an alias of `mode` retained for
     * compatibility with older host builds.
     */
    getReplaygainMode: () => bridge.invoke(
      "config.getReplaygainMode"
    ),
    setCursorFollowPlayback: (enabled) => bridge.invoke("config.setCursorFollowPlayback", {
      enabled
    }),
    setPlaybackFollowCursor: (enabled) => bridge.invoke("config.setPlaybackFollowCursor", {
      enabled
    }),
    /**
     * Set the active ReplayGain source mode.
     *
     * Accepts either an integer (`0`-`3`, see `REPLAYGAIN_SOURCE_MODE`)
     * or the named alias the host accepts on input
     * (`'none' | 'track' | 'album' | 'byPlaybackOrder' | 'auto'`).
     * `'auto'` is treated by the host as an alias of
     * `'byPlaybackOrder'` and yields integer mode `3`.
     *
     * @param mode - Numeric mode or named alias.
     * @returns Echoes the integer mode the host applied. When an
     *          invalid `'auto'`-style string slips past the typed
     *          surface the host returns `code: 'INVALID_PARAMS'` plus a
     *          human-readable `error` instead of `success: true`.
     */
    setReplaygainMode: (mode) => bridge.invoke(
      "config.setReplaygainMode",
      typeof mode === "number" ? { mode } : { sourceMode: mode }
    )
  };

  // src/bridge/namespaces/consoleApi.ts
  var consoleApi = {
    log: (message) => bridge.invoke("console.log", { message }),
    warn: (message) => bridge.invoke("console.warn", { message }),
    error: (message) => bridge.invoke("console.error", { message })
  };

  // src/bridge/namespaces/cursor.ts
  var cursor = {
    /**
     * Hide or restore the calling window's client-area cursor.
     *
     * Repeated calls with the same `hidden` value resolve with
     * `success: true, changed: false` — only flips that actually move
     * the visibility flag emit a follow-up `cursor:hiddenChanged`
     * event. Validation failures (caller-window resolver miss) resolve
     * with `success: false` and a human-readable `error` string.
     *
     * @param hidden - `true` to hide, `false` to restore.
     */
    setHidden: (hidden) => bridge.invoke("cursor.setHidden", { hidden }),
    /**
     * Read the current hidden state for the calling window. Returns
     * `{ hidden: false }` when the caller window cannot be resolved.
     */
    isHidden: () => bridge.invoke("cursor.isHidden")
  };

  // src/bridge/namespaces/dialog.ts
  var dialog = {
    /** Resolves with `{ canceled, filePaths }`; `filePaths` is empty when cancelled. */
    openFile: (opts) => bridge.invoke("dialog.openFile", opts),
    /** Resolves with `{ canceled, filePath }`; `filePath` is empty when cancelled. */
    saveFile: (opts) => bridge.invoke("dialog.saveFile", opts),
    /** Resolves with `{ canceled, folderPath }`; `folderPath` is empty when cancelled. */
    openFolder: (opts) => bridge.invoke("dialog.openFolder", opts),
    /**
     * Shows a modal confirmation dialog.
     *
     * Resolves with `{ response }`, the zero-based index of the clicked button
     * in `buttons`. The default button set is `['OK', 'Cancel']`, so `0` means
     * confirmed and `1` means cancelled - there is no `confirmed` flag.
     * The task dialog is created without `TDF_ALLOW_DIALOG_CANCELLATION`, so
     * Escape and the close button do not dismiss it and every result comes
     * from an actual button click. `-1` appears only on the host's fallback
     * path, when even a plain message box could not be shown.
     *
     * `response` is typed `unknown` because the host builds it arithmetically
     * and the extractor cannot see the result type; narrow it at the call site.
     */
    confirm: (opts) => bridge.invoke("dialog.confirm", opts)
  };

  // src/bridge/namespaces/discovery.ts
  var discovery = {
    getAllServices: () => bridge.invoke(
      "discovery.getAllServices"
    ),
    /**
     * Lists main-menu commands. Components that build their submenu at runtime
     * (`mainmenu_commands_v2`, e.g. ESLyric) are expanded by default, so the
     * result includes their child commands in addition to the parent slot.
     * Pass `{ expandDynamic: false }` for the raw static registry only.
     *
     * Entries the host would not show — a command whose `get_display()` returns
     * false, or one carrying `flag_defaulthidden` — are omitted by default,
     * because they are not reachable from the real menu. Pass
     * `{ includeHidden: true }` to get the unfiltered superset.
     */
    getMainMenuCommands: (opts) => bridge.invoke(
      "discovery.getMainMenuCommands",
      opts
    ),
    getMainMenuGroups: () => bridge.invoke(
      "discovery.getMainMenuGroups"
    ),
    /**
     * Executes a main-menu command. For a command expanded from a dynamic
     * submenu, pass the entry's `subGuid` as well; without it only the static
     * command GUID is dispatched.
     */
    executeMainMenuCommand: (guid, subGuid) => bridge.invoke(
      "discovery.executeMainMenuCommand",
      subGuid ? { guid, subGuid } : { guid }
    ),
    /**
     * Lists context-menu commands with their state.
     *
     * `enabled` / `checked` are only observable when a track is selected or
     * playing, because the SDK evaluates display data against a track set.
     * Check the response's `stateKnown` before trusting them: when it is false,
     * only `hidden` is meaningful. `FORCE_OFF` entries are shortcut-list-only
     * per the SDK and are omitted unless `includeHidden` is set.
     */
    getContextMenuCommands: (opts) => bridge.invoke(
      "discovery.getContextMenuCommands",
      opts
    ),
    /**
     * Executes a context-menu command by GUID against the current selection (or
     * the playing track).
     *
     * A `FORCE_OFF` command is refused rather than dispatched: the SDK treats
     * that state as "keyboard-shortcut list only", so the host never draws it and
     * running it would perform something the user could not have clicked. Such a
     * refusal comes back as `success: false` with `hidden: true`. Pass
     * `{ force: true }` to dispatch anyway. `DEFAULT_OFF` commands (hidden unless
     * Shift is held) are still invocable and are never refused.
     */
    executeContextMenuCommand: (opts) => bridge.invoke(
      "discovery.executeContextMenuCommand",
      opts
    ),
    /**
     * Executes a context-menu command addressed by its display path, e.g.
     * `'Playback Statistics/Rating/5'`.
     *
     * Each path segment must match a menu label exactly once, after normalization
     * (mnemonic `&`, a trailing ellipsis, accelerator text and ASCII case are
     * ignored). Matching is never a substring test, so `'Rating/1'` cannot
     * resolve to `'Rating/10'`.
     *
     * A path that matches several commands is refused instead of guessed —
     * duplicated labels are common in real hosts. That comes back as
     * `success: false` with `match: 'ambiguous'` and a `candidates` list of full
     * names; use it to refine the path, or address the command by GUID via
     * {@link executeContextMenuCommand}, which is the only stable identifier.
     */
    executeContextMenuByPath: (opts) => bridge.invoke("discovery.executeContextMenuByPath", opts),
    /**
     * Dumps the full context-menu tree for the current selection (or the playing
     * track), as the host would build it.
     *
     * The walk is bounded in depth and in children per node, and any clipping is
     * reported rather than silent: check `truncated` on the response for the whole
     * tree, or on an individual node for its subtree. A popup node carries both
     * `childCount` (the host's real count) and `childrenReturned` (what this
     * response contains) so the two can be reconciled without counting.
     */
    getContextMenuTree: () => bridge.invoke(
      "discovery.getContextMenuTree"
    ),
    getInputFormats: () => bridge.invoke(
      "discovery.getInputFormats"
    ),
    getComponents: () => bridge.invoke("discovery.getComponents"),
    getUIElements: () => bridge.invoke("discovery.getUIElements"),
    getDspEntries: () => bridge.invoke("discovery.getDspEntries"),
    getOutputDevices: () => bridge.invoke(
      "discovery.getOutputDevices"
    ),
    getPreferencePages: () => bridge.invoke(
      "discovery.getPreferencePages"
    ),
    /**
     * Case-insensitive substring search over command names, descriptions and menu
     * paths, across both menu families.
     *
     * Each hit carries `type` (`'mainmenu'` / `'contextmenu'`) plus the same state
     * fields the enumeration endpoints return, so a caller can tell whether a hit
     * is invocable without a second round trip. Pass `{ scope: 'mainmenu' }` or
     * `{ scope: 'contextmenu' }` to search one family only.
     *
     * Entries the host would not show are excluded, matching the enumeration
     * endpoints; pass `{ includeHidden: true }` for the unfiltered superset.
     * Dynamic submenus are expanded by default — pass `{ expandDynamic: false }`
     * for the static registry only.
     *
     * Context-menu state is only observable with a track selected or playing.
     * When the context family was searched without one, the response's
     * `stateKnown` is false and its hits' `enabled` / `checked` must not be
     * filtered on.
     */
    searchCommands: (query, opts) => bridge.invoke(
      "discovery.searchCommands",
      { query, ...opts }
    )
  };

  // src/bridge/namespaces/dnd.ts
  function readSnapshot() {
    const slot = globalThis.__fbDndSession;
    return slot ?? null;
  }
  var dnd = {
    /**
     * Paths of the current drag session from the page-side snapshot.
     *
     * Synchronous and therefore best-effort: returns an empty array when no
     * session is active, when the drag carries no file list, when the origin is
     * not trusted with paths, or when the host has not published the session
     * yet. A fast drag can reach the page's `drop` handler before publication
     * completes, so do not use this as the only source of paths — prefer
     * {@link dnd.getPathsAsync} and keep this for optimistic UI.
     */
    getPaths: () => {
      const snap = readSnapshot();
      return snap ? snap.paths.slice() : [];
    },
    /**
     * Shortcut targets for the current drag session, parallel to
     * {@link dnd.getPaths}.
     *
     * Windows puts the `.lnk` file itself in a dropped file list, which
     * foobar2000 cannot play, so the host reads each shortcut's target and
     * publishes it at the same index. The two arrays are always the same
     * length, and an entry is `null` whenever no target is available: the path
     * is not a shortcut, the shortcut names a shell namespace object such as
     * the recycle bin instead of a file, the recorded target is too long to
     * come back intact (Windows caps it at `MAX_PATH`, and a truncated path
     * would name a different file), COM was unavailable, or resolution was
     * skipped to keep the drop responsive. Never an empty string, so a
     * truthiness test is enough.
     *
     * A target says where the shortcut points, not that the file is there: a
     * BROKEN shortcut reports the path its `.lnk` recorded rather than `null`,
     * because Windows hands that path back whether or not the target still
     * exists, and the host cannot afford a filesystem check on the thread the
     * drag blocks. Expect a non-null entry to occasionally name nothing.
     *
     * Only `.lnk` is resolved. `.url`, `.library-ms` and virtual search results
     * report `null`.
     *
     * Synchronous snapshot read, so it carries the same timing caveat as
     * {@link dnd.getPaths} and returns an empty array in an iframe. The
     * `resolvedPaths` field of {@link dnd.getPathsAsync} and of the `dnd:enter`
     * / `dnd:drop` payloads is the reliable equivalent.
     *
     * ```js
     * const paths = fb.dnd.getPaths();
     * const targets = fb.dnd.getResolvedPaths();
     * const playable = paths.map((p, i) => targets[i] ?? p);
     * ```
     */
    getResolvedPaths: () => {
      const snap = readSnapshot();
      if (!snap) {
        return [];
      }
      const resolved = snap.resolvedPaths;
      return Array.isArray(resolved) ? snap.paths.map((_, i) => resolved[i] ?? null) : snap.paths.map(() => null);
    },
    /**
     * Whether the snapshot says the current drag carries a file list.
     *
     * Useful during `dragover`, where the browser withholds
     * `dataTransfer.files` and exposes only `items.length`, leaving the page
     * unable to tell files from other payloads. Carries the same timing caveat
     * as {@link dnd.getPaths}; the authoritative value is the `hasFiles` field
     * of the `dnd:enter` payload.
     */
    hasFiles: () => {
      const snap = readSnapshot();
      return snap ? snap.hasFiles : false;
    },
    /**
     * Queries the host for a drag session's real filesystem paths.
     *
     * The reliable way to obtain paths from inside a HTML5 `drop` handler: it
     * reads the host's session state rather than a snapshot pushed to the page,
     * so it does not depend on message delivery order. Safe to call after
     * `await`, since it never touches `event.dataTransfer`.
     *
     * Paths come back in the same order as `DataTransfer.files`, so a page can
     * pair them by index. `resolvedPaths` carries the `.lnk` target for each
     * index, or `null`, and is always the same length as `paths`.
     *
     * Reads host memory only: the shortcut targets were resolved once when the
     * drag arrived, so calling this repeatedly costs no filesystem access.
     *
     * @param sessionId Session to query, from a `dnd:*` payload. Omit to query
     *                  the session that is active or most recently ended for
     *                  this window.
     * @returns Resolved session id, its paths, and the parallel shortcut
     *          targets. Both arrays are empty when the session expired, carried
     *          no file list, or the origin is not trusted with paths.
     */
    getPathsAsync: (sessionId) => bridge.invoke(
      "dnd.getPathsAsync",
      sessionId ? { sessionId } : {}
    ),
    /**
     * What this window's drag-drop integration can currently deliver.
     *
     * Not constant for the window's lifetime: navigating to a different origin,
     * or Chromium re-registering its own drop target, can withdraw path access
     * while leaving HTML5 drag events intact. Subscribe to
     * `dnd:capabilitiesChanged` to react to that.
     */
    getCapabilities: () => bridge.invoke("dnd.getCapabilities"),
    /**
     * Dragging tracks out of the window into other applications.
     *
     * Not implemented: it requires a native `IDropSource`, which this component
     * does not provide. The returned promise always RESOLVES with a
     * `{ success: false, code: 'NOT_SUPPORTED' }` envelope rather than
     * rejecting, because the host delivers handler-returned error envelopes as
     * a normal result. Test `success`; a `catch` block will never run.
     *
     * @param _type Accepted and ignored, so existing call sites still compile.
     *              The host reads no parameters from this call.
     */
    startDrag: (_type) => bridge.invoke("dnd.startDrag")
  };

  // src/bridge/namespaces/dsp.ts
  var dsp = {
    getChain: () => bridge.invoke("dsp.getChain"),
    setChain: (dsps) => bridge.invoke("dsp.setChain", {
      dsps
    }),
    getPresets: () => bridge.invoke("dsp.getPresets"),
    /** Accepts either preset index (number) or preset name (string). */
    applyPreset: (indexOrName) => bridge.invoke(
      "dsp.applyPreset",
      typeof indexOrName === "string" ? { name: indexOrName } : { index: indexOrName }
    ),
    getAvailable: () => bridge.invoke("dsp.getAvailable"),
    addDsp: (guid, position) => bridge.invoke("dsp.addDsp", {
      guid,
      ...position != null ? { position } : {}
    }),
    removeDsp: (index) => bridge.invoke(
      "dsp.removeDsp",
      { index }
    ),
    moveDsp: (from, to) => bridge.invoke("dsp.moveDsp", { from, to })
  };

  // src/bridge/namespaces/event.ts
  var event = {
    /** Broadcast an event to every connected window (optionally excluding self). */
    emit: (eventName, payload, excludeSelf = false) => bridge.invoke("event.emit", {
      event: eventName,
      payload,
      excludeSelf
    }),
    /** Deliver an event to a specific window by id. */
    emitTo: (eventName, payload, targetWindowId) => bridge.invoke("event.emitTo", {
      event: eventName,
      payload,
      targetWindowId
    })
  };

  // src/bridge/binaryData.ts
  var BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  var RESTRICTED_NAME = "[A-Za-z0-9](?:[A-Za-z0-9!#$&^_.+-]{0,125}[A-Za-z0-9])?";
  var MEDIA_TYPE_PATTERN = new RegExp(`^${RESTRICTED_NAME}/${RESTRICTED_NAME}$`);
  function asBytes(data) {
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }
  function validateBase64(value) {
    if (value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
      throw new TypeError("Expected canonical padded Base64 data.");
    }
    if (value.endsWith("==")) {
      const second = BASE64_ALPHABET.indexOf(value[value.length - 3]);
      if ((second & 15) !== 0) {
        throw new TypeError("Expected canonical padded Base64 data.");
      }
    } else if (value.endsWith("=")) {
      const third = BASE64_ALPHABET.indexOf(value[value.length - 2]);
      if ((third & 3) !== 0) {
        throw new TypeError("Expected canonical padded Base64 data.");
      }
    }
  }
  function bytesToBase64(data) {
    const bytes = asBytes(data);
    let result = "";
    for (let index = 0; index < bytes.length; index += 3) {
      const first = bytes[index] ?? 0;
      const second = bytes[index + 1] ?? 0;
      const third = bytes[index + 2] ?? 0;
      const remaining = bytes.length - index;
      result += BASE64_ALPHABET[first >> 2];
      result += BASE64_ALPHABET[(first & 3) << 4 | second >> 4];
      result += remaining > 1 ? BASE64_ALPHABET[(second & 15) << 2 | third >> 6] : "=";
      result += remaining > 2 ? BASE64_ALPHABET[third & 63] : "=";
    }
    return result;
  }
  function base64ToBytes(value) {
    validateBase64(value);
    if (value.length === 0) return new Uint8Array();
    let padding = 0;
    if (value.endsWith("==")) {
      padding = 2;
    } else if (value.endsWith("=")) {
      padding = 1;
    }
    const output2 = new Uint8Array(value.length / 4 * 3 - padding);
    let outputIndex = 0;
    for (let index = 0; index < value.length; index += 4) {
      const first = BASE64_ALPHABET.indexOf(value[index]);
      const second = BASE64_ALPHABET.indexOf(value[index + 1]);
      const third = value[index + 2] === "=" ? 0 : BASE64_ALPHABET.indexOf(value[index + 2]);
      const fourth = value[index + 3] === "=" ? 0 : BASE64_ALPHABET.indexOf(value[index + 3]);
      const combined = first << 18 | second << 12 | third << 6 | fourth;
      if (outputIndex < output2.length) output2[outputIndex++] = combined >> 16;
      if (outputIndex < output2.length) output2[outputIndex++] = combined >> 8;
      if (outputIndex < output2.length) output2[outputIndex++] = combined;
    }
    return output2;
  }
  function parseBase64DataUrl(dataUrl) {
    if (!dataUrl.startsWith("data:")) {
      throw new TypeError("Expected a Base64 data URL.");
    }
    const commaIndex = dataUrl.indexOf(",");
    if (commaIndex < 0) {
      throw new TypeError("Expected a Base64 data URL with a payload.");
    }
    const descriptor = dataUrl.slice(5, commaIndex);
    const parts = descriptor.split(";");
    const mediaType = parts.shift() ?? "";
    if (!MEDIA_TYPE_PATTERN.test(mediaType)) {
      throw new TypeError("Expected an explicit valid media type.");
    }
    if (parts.length !== 1 || parts[0].toLowerCase() !== "base64") {
      throw new TypeError("Expected a Base64 data URL.");
    }
    const base64 = dataUrl.slice(commaIndex + 1);
    if (base64.length === 0) {
      throw new TypeError("Expected a Base64 data URL with a payload.");
    }
    validateBase64(base64);
    return { mediaType: mediaType.toLowerCase(), base64 };
  }

  // src/bridge/namespaces/file.ts
  async function fileReadBinary(path) {
    const response = await bridge.invoke(
      "file.read",
      { path, encoding: "binary" }
    );
    if (response?.success === false) {
      throw new Error(response.error ?? "file.read failed.");
    }
    if (typeof response?.content !== "string") {
      throw new TypeError("file.read did not return binary content.");
    }
    return base64ToBytes(response.content);
  }
  function fileWriteBinary(path, bytes, opts) {
    return bridge.invoke("file.write", {
      ...opts,
      path,
      content: `base64:${bytesToBase64(bytes)}`,
      encoding: "binary"
    });
  }
  async function fileWriteDataUrl(path, dataUrl, opts) {
    const { base64 } = parseBase64DataUrl(dataUrl);
    return bridge.invoke(
      "file.write",
      {
        ...opts,
        path,
        content: `base64:${base64}`,
        encoding: "binary"
      }
    );
  }
  var file = {
    read: (path, opts) => bridge.invoke("file.read", {
      path,
      ...opts || {}
    }),
    write: (path, content, opts) => bridge.invoke("file.write", {
      path,
      content,
      ...opts || {}
    }),
    exists: (path) => bridge.invoke("file.exists", { path }),
    list: (path, opts) => bridge.invoke("file.list", {
      path,
      ...opts || {}
    }),
    delete: (path, opts) => bridge.invoke("file.delete", {
      path,
      ...opts || {}
    }),
    mkdir: (path) => bridge.invoke("file.mkdir", {
      path
    }),
    copy: (source, destination, opts) => bridge.invoke("file.copy", {
      source,
      destination,
      ...opts || {}
    }),
    move: (source, destination) => bridge.invoke("file.move", { source, destination }),
    rename: (path, newName) => bridge.invoke(
      "file.rename",
      { path, newName }
    ),
    getInfo: (path) => bridge.invoke("file.getInfo", { path }),
    /**
     * Cancellable, non-blocking batch copy. The work runs on a host worker
     * thread, so copying a large album no longer freezes the UI the way
     * `file.copy` does.
     *
     * Returns a `{ operationId, totalCount }` receipt immediately; the outcome
     * arrives in batches on `file:opProgress`, followed by one
     * `file:opComplete`. Two paths skip that closing event - the host shutting
     * down mid-run, and an unexpected host-side failure - so a listener that
     * must not leak state should carry its own timeout rather than wait on it
     * forever.
     *
     * Both events go to the window that made the call while that window is
     * alive. Once it is gone the host can no longer resolve it and falls back
     * to the main instance, so a late event may surface in a window that did
     * not start the operation.
     *
     * One result is reported per entry, not per file: a directory entry is
     * reported once its whole tree has been walked. Copying a directory onto an
     * existing directory merges into it, and files already present there are
     * skipped without being reported individually, so the entry still reports
     * `status: 'ok'`. A file entry whose destination already exists is reported
     * as `skipped` / `already-exists` unless `overwrite` is set.
     *
     * Path validation is all-or-nothing: if any entry fails the host's read or
     * write check, the whole call is rejected with `PERMISSION_DENIED` and no
     * `operationId` is produced. At most 8 operations may be in flight
     * process-wide.
     *
     * @param items Source/destination pairs; must not be empty.
     * @param opts `overwrite` (default `false`) replaces existing destinations.
     * @returns Dispatch receipt; the actual results arrive by event.
     */
    copyAsync: (items, opts) => bridge.invoke("file.copyAsync", {
      items,
      ...opts || {}
    }),
    /**
     * Cancellable, non-blocking batch move, with the same receipt-plus-events
     * contract as {@link file.copyAsync}.
     *
     * Within one volume a move is a rename and costs nothing regardless of
     * size. Across volumes the host falls back to copy-then-delete-source; that
     * entry still reports `status: 'ok'` but carries `reason: 'cross-volume'`
     * so the extra cost is visible. Unlike {@link file.copyAsync}, a directory
     * whose destination already exists is reported as `skipped` /
     * `already-exists` rather than merged.
     *
     * `overwrite` covers file destinations only. An existing *directory*
     * destination is never replaced, because Windows cannot swap a directory
     * in place: on the same volume such an entry ends as `skipped` or `failed`
     * instead of overwriting.
     *
     * @param items Source/destination pairs; must not be empty.
     * @param opts `overwrite` (default `false`) replaces an existing file
     *   destination. Note the synchronous `file.move` always replaces one.
     * @returns Dispatch receipt; the actual results arrive by event.
     */
    moveAsync: (items, opts) => bridge.invoke("file.moveAsync", {
      items,
      ...opts || {}
    }),
    /**
     * Cancellable, non-blocking batch delete, with the same receipt-plus-events
     * contract as {@link file.copyAsync}. Results carry no `destination`.
     *
     * `moveToTrash: true` (the default) hands each path to the shell, which
     * requires the host's main thread, so those deletes run there in batches of
     * 16 and yield in between. `moveToTrash: false` deletes on a worker thread
     * and removes non-empty directories, which the synchronous `file.delete`
     * refuses to do in that mode.
     *
     * @param paths Paths to delete; must not be empty.
     * @param opts `moveToTrash` (default `true`) keeps deletions recoverable.
     * @returns Dispatch receipt; the actual results arrive by event.
     */
    deleteAsync: (paths, opts) => bridge.invoke("file.deleteAsync", {
      paths,
      ...opts || {}
    }),
    /**
     * Stop an operation started by {@link file.copyAsync},
     * {@link file.moveAsync} or {@link file.deleteAsync}.
     *
     * Cancellation takes effect part-way through a batch rather than at the end
     * of it. A copy or move stops within one file - the file in flight is
     * aborted and its partial copy removed; a delete stops at the next entry.
     * Entries already done keep their results, every remaining entry is
     * reported as `skipped` / `cancelled`, and the run still ends with a
     * `file:opComplete` carrying `cancelled: true`. Closing a popup cancels the
     * operations that popup started; a panel host has no such hook, so its
     * operations run to the end unless this method stops them.
     *
     * @param operationId The id from the dispatch receipt.
     * @returns `cancelled: false` when the operation had already finished or
     *   never existed; the two cases are deliberately indistinguishable.
     */
    cancelOp: (operationId) => bridge.invoke("file.cancelOp", { operationId }),
    /** Read exact bytes; rejects on Host failure or malformed Base64. */
    readBinary: fileReadBinary,
    /** Write exact bytes using the host's `base64:` binary wire format. */
    writeBinary: fileWriteBinary,
    /** Write a canonical Base64 Data URL; rejects malformed input. */
    writeDataUrl: fileWriteDataUrl
  };

  // src/bridge/namespaces/http.ts
  var _defaultHttpDownloadLoggerOff = bridge.on(
    "http:downloadComplete",
    (event2) => {
      if (event2 && event2.success === false && !event2.cancelled) {
        console.warn("[fb.http] download failed:", {
          requestId: event2.requestId,
          path: event2.path,
          status: event2.status,
          error: event2.error,
          bytesWritten: event2.bytesWritten
        });
      }
    }
  );
  function disableDefaultHttpDownloadLogger() {
    if (_defaultHttpDownloadLoggerOff) {
      _defaultHttpDownloadLoggerOff();
      _defaultHttpDownloadLoggerOff = null;
    }
  }
  function _wantsBinary(opts) {
    return opts?.responseType === "arraybuffer" || opts?.responseType === "binary";
  }
  function _base64ToArrayBuffer(s) {
    const decode = typeof atob === "function" ? atob : (input) => {
      const lookup = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      const cleaned = input.replace(/=+$/, "");
      let bits = 0;
      let value = 0;
      let out = "";
      for (let i = 0; i < cleaned.length; i++) {
        const idx = lookup.indexOf(cleaned.charAt(i));
        if (idx < 0) continue;
        value = value << 6 | idx;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          out += String.fromCharCode(value >> bits & 255);
        }
      }
      return out;
    };
    const bin = decode(s);
    const len = bin.length;
    const buf = new ArrayBuffer(len);
    const view = new Uint8Array(buf);
    for (let i = 0; i < len; i++) view[i] = bin.charCodeAt(i);
    return buf;
  }
  function _decodeBinary(resp) {
    if (!resp || typeof resp.body !== "string") {
      return resp;
    }
    if (resp.responseType !== "base64") {
      return resp;
    }
    const decoded = _base64ToArrayBuffer(resp.body);
    return { ...resp, body: decoded };
  }
  function _finalizeHttp(promise, opts) {
    return _wantsBinary(opts) ? promise.then(_decodeBinary) : promise;
  }
  function httpGet(url, opts) {
    return _finalizeHttp(bridge.invoke("http.get", { url, ...opts || {} }), opts);
  }
  function httpPost(url, body, opts) {
    return _finalizeHttp(bridge.invoke("http.post", { url, body, ...opts || {} }), opts);
  }
  function httpPut(url, body, opts) {
    return _finalizeHttp(bridge.invoke("http.put", { url, body, ...opts || {} }), opts);
  }
  function httpDelete(url, body, opts) {
    return _finalizeHttp(bridge.invoke("http.delete", { url, body, ...opts || {} }), opts);
  }
  function httpPatch(url, body, opts) {
    return _finalizeHttp(bridge.invoke("http.patch", { url, body, ...opts || {} }), opts);
  }
  function httpHead(url, opts) {
    return bridge.invoke("http.head", { url, ...opts || {} });
  }
  function httpRequest(url, opts) {
    const promise = _httpRequest(
      { url, ...opts || {} },
      typeof opts?.timeout === "number" ? opts.timeout + 5e3 : 35e3
    );
    return _wantsBinary(opts) ? promise.then(_decodeBinary) : promise;
  }
  var http = {
    get: httpGet,
    post: httpPost,
    put: httpPut,
    delete: httpDelete,
    patch: httpPatch,
    head: httpHead,
    download: (url, saveTo, opts) => bridge.invoke("http.download", { url, saveTo, ...opts || {} }),
    abort: (requestId) => bridge.invoke("http.abort", {
      requestId
    }),
    /** Detach the default failure logger; see {@link disableDefaultHttpDownloadLogger}. */
    disableDefaultDownloadLogger: disableDefaultHttpDownloadLogger,
    /**
     * Event-driven GET that awaits the `http:response` event. The
     * host may either respond synchronously (`async: false`) or queue
     * the request and deliver the result via `http:response`. A
     * client-side timeout (default 35 s) guards against the event
     * never arriving.
     */
    request: httpRequest
  };
  function _httpRequest(payload, clientTimeoutMs = 35e3) {
    return new Promise((resolve, reject) => {
      let timerId = null;
      let off = null;
      const cleanup = () => {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        if (off !== null) {
          off();
          off = null;
        }
      };
      bridge.invoke("http.get", payload).then((init) => {
        if (!init || !init.async) {
          cleanup();
          if (init && init.success === false) {
            reject(new Error(init.error || "HTTP request failed"));
          } else {
            resolve(init);
          }
          return;
        }
        const requestId = init.requestId;
        if (!requestId) {
          cleanup();
          reject(
            new Error(
              "HTTP async response missing requestId (host contract violation)."
            )
          );
          return;
        }
        timerId = setTimeout(() => {
          cleanup();
          bridge.invoke("http.abort", { requestId }).catch(() => {
          });
          reject(
            new Error(
              `HTTP request timeout (clientTimeout=${clientTimeoutMs}ms, requestId=${requestId})`
            )
          );
        }, clientTimeoutMs);
        off = bridge.on(
          "http:response",
          (raw) => {
            const data = raw;
            if (!data || data.requestId !== requestId) return;
            cleanup();
            if (data.success) {
              resolve(data);
            } else {
              const err = new Error(data.error || "HTTP request failed");
              err.response = data;
              reject(err);
            }
          }
        );
      }).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  // src/bridge/namespaces/jitQueue.ts
  var jitQueue = {
    getState: () => bridge.invoke("jitQueue.getState"),
    /**
     * Enqueue the next track. URLs are capped at 2048 chars; over-length
     * URLs resolve with `{success:false, error:"URL exceeds maximum length (2048)"}`.
     */
    enqueueNext: (opts) => bridge.invoke(
      "jitQueue.enqueueNext",
      opts
    ),
    /**
     * Start playing the given track immediately. URLs are capped at 2048
     * chars; over-length URLs resolve with
     * `{success:false, error:"URL exceeds maximum length (2048)"}`.
     */
    playNow: (opts) => bridge.invoke(
      "jitQueue.playNow",
      opts
    ),
    skip: () => bridge.invoke(
      "jitQueue.skip"
    ),
    stop: () => bridge.invoke("jitQueue.stop"),
    clear: () => bridge.invoke("jitQueue.clear"),
    notifyEmpty: () => bridge.invoke("jitQueue.notifyEmpty"),
    /**
     * Batch-preload tracks. Each URL is capped at 2048 chars; over-length
     * URLs are silently skipped and counted in `invalidCount`.
     */
    preloadBatch: (opts) => bridge.invoke(
      "jitQueue.preloadBatch",
      opts
    )
  };

  // src/bridge/namespaces/keyboard.ts
  var keyboard = {
    registerHotkey: (key, action, opts) => bridge.invoke(
      "keyboard.registerHotkey",
      {
        key,
        action,
        ...opts || {}
      }
    ),
    registerShortcut: (key, action) => bridge.invoke("keyboard.registerShortcut", {
      key,
      action
    }),
    unregisterHotkey: (opts) => bridge.invoke("keyboard.unregisterHotkey", opts),
    getRegisteredHotkeys: () => bridge.invoke(
      "keyboard.getRegisteredHotkeys"
    )
  };

  // src/bridge/namespaces/library.ts
  var library = {
    // ── Search / aggregation ────────────────────────────────────────────
    /**
     * Run a foobar2000 query expression against the media library.
     *
     * `options.offset` / `limit` page the hit list; `total` and `hasMore`
     * report the full extent. `options.fields` projects each row down to
     * the requested {@link TrackInfo} keys — runtime rows then hold only
     * those keys while the declared type stays complete. An invalid
     * `fields` selection resolves — never rejects — with
     * `{ success: false, code: 'INVALID_PARAMS' }`.
     */
    search: (query, limit, options) => bridge.invoke("library.search", {
      query,
      limit,
      ...options && typeof options === "object" ? options : {}
    }),
    getAlbums: (options) => bridge.invoke(
      "library.getAlbums",
      typeof options === "number" ? { limit: options } : { ...options || {} }
    ),
    getArtists: (limit, options) => bridge.invoke("library.getArtists", {
      limit,
      ...options && typeof options === "object" ? options : {}
    }),
    getGenres: () => bridge.invoke("library.getGenres"),
    getStats: () => bridge.invoke("library.getStats"),
    getStatus: () => bridge.invoke("library.getStatus"),
    getCount: () => bridge.invoke("library.getCount"),
    /**
     * Fetch library tracks. Resolves synchronously for paged requests and
     * cache hits. When the host offloads a full-library serialization to a
     * background worker it returns `{ pending: true, requestId }`; this
     * wrapper then awaits the `library:getAllResult` event (filtered by
     * `requestId`) with a client-side timeout (default 60 s, override via
     * `opts.timeout`). The resolved shape is always a
     * {@link LibraryPagedTracksResponse}, so callers are unaffected by the
     * threading model.
     */
    getAll: async (start, count, opts = {}) => {
      const result = await bridge.invoke("library.getAll", {
        start,
        count,
        asyncResult: true
      });
      if (result?.pending === true && result.requestId) {
        const timeoutMs = opts.timeout ?? 6e4;
        const requestId = result.requestId;
        return new Promise(
          (resolve, reject) => {
            let timer = null;
            const cleanup = () => {
              off();
              if (timer) {
                clearTimeout(timer);
                timer = null;
              }
            };
            const off = bridge.on(
              "library:getAllResult",
              (raw) => {
                const e = raw;
                if (e?.requestId !== requestId) return;
                cleanup();
                if (e.error) {
                  reject(e);
                  return;
                }
                resolve(e);
              }
            );
            if (timeoutMs > 0) {
              timer = setTimeout(() => {
                cleanup();
                reject({
                  success: false,
                  error: "TIMEOUT",
                  message: "library.getAll timed out after " + timeoutMs + "ms",
                  requestId
                });
              }, timeoutMs);
            }
          }
        );
      }
      return result;
    },
    refresh: () => bridge.invoke("library.refresh"),
    getByPath: (path) => bridge.invoke("library.getByPath", {
      path
    }),
    addToPlaylist: (paths, playlist2) => bridge.invoke("library.addToPlaylist", {
      paths,
      ...playlist2 != null ? { playlist: playlist2 } : {}
    }),
    // ── Roots / typed tree ──────────────────────────────────────────────
    getRoots: () => bridge.invoke("library.getRoots"),
    browseTree: (params) => bridge.invoke("library.browseTree", {
      rootId: params.rootId,
      ...params.pathId != null ? { pathId: params.pathId } : {},
      ...params.includeFiles != null ? { includeFiles: params.includeFiles } : {},
      ...params.recursiveFiles != null ? { recursiveFiles: params.recursiveFiles } : {}
    }),
    // ── Filesystem-based directory listing ──────────────────────────────
    browseDirectory: (path, includeFiles) => bridge.invoke(
      "library.browseDirectory",
      {
        path,
        ...includeFiles != null ? { includeFiles } : {}
      }
    ),
    getAlbumTracks: (album, artist) => bridge.invoke("library.getAlbumTracks", {
      album,
      ...artist ? { artist } : {}
    }),
    getArtistAlbums: (artist, limit) => bridge.invoke("library.getArtistAlbums", {
      artist,
      ...limit != null ? { limit } : {}
    }),
    getArtistTracks: (artist, limit) => bridge.invoke("library.getArtistTracks", {
      artist,
      ...limit != null ? { limit } : {}
    }),
    getCacheStats: () => bridge.invoke("library.getCacheStats"),
    getFieldValues: (field, limit, separator) => bridge.invoke("library.getFieldValues", {
      field,
      ...limit != null ? { limit } : {},
      ...separator ? { separator } : {}
    }),
    /** Semantic alias for {@link library.getFieldValues}. */
    enumerateFieldValues: (field, options = {}) => bridge.invoke("library.getFieldValues", {
      field,
      ...options?.limit != null ? { limit: options.limit } : {},
      ...options?.separator ? { separator: options.separator } : {}
    }),
    // ── Async generators: walk the entire library / tree ────────────────
    /**
     * Async generator that pages through every track in the library.
     * Honours `signal` for cooperative cancellation and emits a
     * progress callback after each page fetch.
     */
    enumerateTracks: async function* (options = {}) {
      const pageSizeRaw = options?.pageSize != null ? Number(options.pageSize) : 500;
      const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.floor(pageSizeRaw) : 500;
      const startRaw = options?.start != null ? Number(options.start) : 0;
      let offset = Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0;
      const useCache = options?.useCache !== false;
      const signal = options?.signal;
      const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
      const countResult = await bridge.invoke(
        "library.getCount",
        {}
      );
      const total = Math.max(0, Number(countResult?.count || 0));
      let pages = 0;
      let fetched = 0;
      let fromCacheHits = 0;
      while (offset < total) {
        if (signal?.aborted) {
          return { total, fetched, pages, fromCacheHits, aborted: true };
        }
        const page = await bridge.invoke("library.getAll", { offset, limit: pageSize, useCache });
        const tracks = Array.isArray(page?.tracks) ? page.tracks : [];
        const items = Array.isArray(page?.items) ? page.items : tracks;
        const currentOffset = Number.isFinite(Number(page?.offset)) ? Number(page.offset) : offset;
        const currentLimit = Number.isFinite(Number(page?.limit)) ? Number(page.limit) : pageSize;
        const fromCache = !!page?.fromCache;
        if (fromCache) fromCacheHits++;
        pages += 1;
        fetched += tracks.length;
        if (onProgress) {
          try {
            onProgress({
              fetched,
              total,
              pages,
              offset: currentOffset,
              limit: currentLimit
            });
          } catch {
          }
        }
        yield {
          tracks,
          items,
          total,
          offset: currentOffset,
          limit: currentLimit,
          fromCache,
          fetched,
          pages
        };
        if (tracks.length === 0) break;
        offset = currentOffset + tracks.length;
      }
      return {
        total,
        fetched,
        pages,
        fromCacheHits,
        aborted: !!signal?.aborted
      };
    },
    /**
     * Async generator that walks library directories breadth- or
     * depth-first via the `library.browseDirectory` endpoint.
     *
     * @deprecated Prefer {@link library.enumerateTree} for root-aware
     *             traversal.
     */
    enumerateDirectories: async function* (options = {}) {
      const rootPath = typeof options?.rootPath === "string" ? options.rootPath : "";
      const includeFiles = !!options?.includeFiles;
      const strategy = options?.strategy === "dfs" ? "dfs" : "bfs";
      const signal = options?.signal;
      const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
      const pending = [rootPath];
      const seen = /* @__PURE__ */ new Set();
      let visited = 0;
      while (pending.length > 0) {
        if (signal?.aborted) {
          return { visited, aborted: true };
        }
        const current = strategy === "dfs" ? pending.pop() : pending.shift();
        if (typeof current !== "string") continue;
        if (seen.has(current)) continue;
        seen.add(current);
        const result = await bridge.invoke(
          "library.browseDirectory",
          { path: current, includeFiles }
        );
        const directories = Array.isArray(result?.directories) ? result.directories : [];
        const files = Array.isArray(result?.files) ? result.files : [];
        for (const dir of directories) {
          if (typeof dir === "string" && !seen.has(dir)) {
            pending.push(dir);
          }
        }
        visited += 1;
        if (onProgress) {
          try {
            onProgress({
              visited,
              pending: pending.length,
              path: current
            });
          } catch {
          }
        }
        yield {
          path: current,
          directories,
          files,
          visited,
          pending: pending.length,
          success: result?.success !== false,
          error: result?.error
        };
      }
      return { visited, aborted: !!signal?.aborted };
    },
    /**
     * Async generator that walks the typed library tree starting at a
     * given `rootId`. Failed nodes are skipped (still counted) so a
     * partial outage does not abort the traversal.
     */
    enumerateTree: async function* (options) {
      const rootId = options?.rootId;
      if (!rootId) throw new Error("enumerateTree: rootId is required");
      const startPathId = typeof options?.pathId === "string" ? options.pathId : "";
      const includeFiles = !!options?.includeFiles;
      const strategy = options?.strategy === "dfs" ? "dfs" : "bfs";
      const signal = options?.signal;
      const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
      const pending = [startPathId];
      const seen = /* @__PURE__ */ new Set();
      let visited = 0;
      while (pending.length > 0) {
        if (signal?.aborted) {
          return { rootId, visited, aborted: true };
        }
        const currentPathId = strategy === "dfs" ? pending.pop() : pending.shift();
        if (typeof currentPathId !== "string") continue;
        if (seen.has(currentPathId)) continue;
        seen.add(currentPathId);
        const result = await bridge.invoke(
          "library.browseTree",
          {
            rootId,
            pathId: currentPathId,
            includeFiles,
            recursiveFiles: false
          }
        );
        if (!result || !result.success) {
          visited += 1;
          continue;
        }
        const directories = Array.isArray(result.directories) ? result.directories : [];
        for (const dir of directories) {
          if (dir && typeof dir.pathId === "string" && !seen.has(dir.pathId)) {
            pending.push(dir.pathId);
          }
        }
        visited += 1;
        if (onProgress) {
          try {
            onProgress({
              rootId,
              pathId: currentPathId,
              absolutePath: result.absolutePath || "",
              visited,
              pending: pending.length
            });
          } catch {
          }
        }
        yield {
          ...result,
          visited,
          pending: pending.length
        };
      }
      return { rootId, visited, aborted: !!signal?.aborted };
    },
    // ── Convenience queries ─────────────────────────────────────────────
    getRandomTracks: (count) => bridge.invoke("library.getRandomTracks", {
      ...count != null ? { count } : {}
    }),
    getRecentlyAdded: (limit, sortBy) => bridge.invoke("library.getRecentlyAdded", {
      ...limit != null ? { limit } : {},
      ...sortBy ? { sortBy } : {}
    }),
    invalidateCache: () => bridge.invoke("library.invalidateCache"),
    isEnabled: () => bridge.invoke("library.isEnabled"),
    /**
     * Run a foobar2000 query expression with an optional Title Formatting
     * sort expression. Sorting is applied before `limit` truncation and
     * `total` reports the untruncated hit count.
     *
     * `fields` narrows the projection exactly as documented on
     * {@link library.search}: rows then hold only the requested keys out of
     * the same 20-name case-sensitive whitelist, omitting the argument
     * returns all 20, and a malformed list resolves with
     * `{ success: false, code: 'INVALID_PARAMS' }` plus
     * `details.unknownFields`. An explicit `null` is forwarded to the host
     * and rejected there instead of being read as "every field".
     */
    query: (query, sort, limit, fields) => bridge.invoke("library.query", {
      query,
      ...sort ? { sort } : {},
      ...limit != null ? { limit } : {},
      ...fields !== void 0 ? { fields } : {}
    }),
    rescan: () => bridge.invoke("library.rescan")
  };

  // src/bridge/namespaces/log.ts
  var log = {
    write: (message, opts) => bridge.invoke("log.write", {
      message,
      ...opts || {}
    }),
    read: (lines) => bridge.invoke("log.read", {
      ...lines != null ? { lines } : {}
    }),
    clear: () => bridge.invoke("log.clear")
  };

  // src/bridge/namespaces/lyrics.ts
  var lyrics = {
    get: (path, options) => bridge.invoke("lyrics.get", {
      ...path ? { path } : {},
      ...options || {}
    }),
    exists: (path) => bridge.invoke("lyrics.exists", { path }),
    save: (path, lyricsText, opts) => bridge.invoke("lyrics.save", {
      path,
      lyrics: lyricsText,
      ...opts || {}
    })
  };

  // src/bridge/namespaces/menu.ts
  function withPosition(base, position) {
    const merged = { ...base };
    if (position?.x !== void 0) merged.x = position.x;
    if (position?.y !== void 0) merged.y = position.y;
    return merged;
  }
  function buildShowPayload(items, position, opts) {
    const payload = withPosition({ items }, position);
    if (!opts) return payload;
    if (opts.windowModel !== void 0) payload.windowModel = opts.windowModel;
    if (opts.css !== void 0) payload.css = opts.css;
    if (opts.cssReplace !== void 0) payload.cssReplace = opts.cssReplace;
    if (opts.backdrop !== void 0) payload.backdrop = opts.backdrop;
    if (opts.backdropDarkMode !== void 0) payload.backdropDarkMode = opts.backdropDarkMode;
    if (opts.closeAnimationMs !== void 0) payload.closeAnimationMs = opts.closeAnimationMs;
    return payload;
  }
  var menu = {
    /**
     * `root` scopes the returned menu tree (e.g. `'Main'` / `'View'`).
     * `opts.locale` selects the `displayLabel` translation locale; the
     * default `'auto'` keeps the host's native labels untranslated.
     * `opts.i18n: false` disables label translation entirely.
     * `opts.withAvailability` (default `true`) includes per-submenu
     * command availability counters.
     */
    getMainMenu: (root, opts) => bridge.invoke("menu.getMainMenu", {
      ...root ? { root } : {},
      ...opts
    }),
    /**
     * `mode` is one of `'auto' | 'selection' | 'playlist' | 'nowPlaying' | 'handles'`.
     *
     * Prefer `'selection'`, `'playlist'` or `'nowPlaying'` whenever the target
     * is reachable from the host playlist: those resolve handles inside the
     * host and validate no paths. `'handles'` validates every supplied path
     * individually, which costs filesystem metadata calls per entry and is
     * noticeably slower for network shares.
     */
    getContextMenu: (opts) => bridge.invoke("menu.getContextMenu", opts || {}),
    /**
     * Runs a main menu command.
     *
     * `command` accepts a GUID (`'{11213A01-...}'`), a leaf name, or a
     * slash-separated path. Prefer the GUID: it is the only form that is stable
     * across hosts, because a localized build reports localized labels.
     *
     * `opts.subGuid` addresses a dynamic child command, paired with its owning
     * command GUID.
     *
     * Failure is reported as `success: false` with a `code`, never as a thrown
     * host error: `MENU_ITEM_DISABLED` (command exists but is greyed out),
     * `MENU_MATCH_AMBIGUOUS` (the name matched several commands — `candidates`
     * lists them), `MENU_COMMAND_NOT_FOUND`.
     */
    runMainMenuCommand: (command, opts) => bridge.invoke(
      "menu.runMainMenuCommand",
      { command, ...opts }
    ),
    /**
     * Runs a context-menu command against the now-playing track, falling back
     * to the active playlist selection.
     *
     * `command` accepts a GUID or a command name. `opts.subGuid` addresses a
     * dynamically generated child (a rating value, a converter preset); without
     * it the owning container is targeted instead, which is a silent no-op.
     *
     * `executionConfirmed` distinguishes "the host reported the command ran"
     * from "the command was dispatched through an entry point that returns
     * nothing". It is absent on the early-validation failures.
     */
    runContextCommand: (command, opts) => bridge.invoke("menu.runContextCommand", {
      command,
      ...opts
    }),
    runContextCommandById: (id, opts) => bridge.invoke("menu.runContextCommandById", {
      id,
      ...opts
    }),
    /**
     * Defaults to `auto`: handles, now playing, playlist selection, then
     * playlist context.
     *
     * The same cost note as {@link getContextMenu} applies — prefer
     * `mode: 'selection'` over supplying `handles` for playlist rows.
     */
    showNativePopup: (opts) => bridge.invoke("menu.showNativePopup", opts || {}),
    /**
     * Show a self-drawn (WebView-rendered) popup menu at `position`
     * (defaults to the cursor). Resolves with the new menu id; the
     * user's choice arrives asynchronously via the `menu:select` /
     * `menu:dismiss` events, and a rich control's value change via
     * `menu:valueChanged` (which leaves the menu open). Prefer
     * {@link popup} when you only need the chosen item id.
     *
     * `opts` configures presentation per call. For a context menu prefer
     * `windowModel: 'contentSized'`, which draws each panel in a compact
     * window carrying the real DWM {@link MenuPopupOptions.backdrop} material
     * and the system shadow; `opts.css` restyles the menu (and with
     * `cssReplace: true` takes the look over entirely).
     *
     * ```javascript
     * const { menuId } = await fb.menu.show(items, { x: e.screenX, y: e.screenY }, {
     *     windowModel: 'contentSized',
     *     backdrop: 'acrylic',
     *     css: '.fb-menu { background: rgba(32, 32, 32, 0.82); }',
     * });
     * ```
     */
    show: (items, position, opts) => bridge.invoke(
      "menu.show",
      buildShowPayload(items, position, opts)
    ),
    /** Close the active self-drawn popup menu, if any. */
    close: (reason) => bridge.invoke(
      "menu.close",
      reason ? { reason } : {}
    ),
    /**
     * Show a self-drawn popup menu and await the user's choice. Resolves
     * with the selected item id, or `null` when the menu is dismissed
     * (outside click, Escape, or any other close reason). Events are
     * matched by the menu id returned from `menu.show`, so overlapping
     * callers never cross-resolve.
     *
     * `opts` is the same per-call presentation config as {@link show};
     * `windowModel: 'contentSized'` is the recommended model for a context
     * menu. Rich controls report through `menu:valueChanged` without closing
     * the menu, so this promise stays pending until an ordinary row is chosen
     * or the menu is dismissed — subscribe to that event separately to track
     * value changes.
     *
     * ```javascript
     * document.addEventListener('contextmenu', async (e) => {
     *     e.preventDefault();
     *     const id = await fb.menu.popup(items, undefined, {
     *         windowModel: 'contentSized',
     *         backdrop: 'acrylic',
     *     });
     *     if (id) console.log('selected', id);
     * });
     * ```
     */
    popup: async (items, position, opts) => {
      const res = await bridge.invoke(
        "menu.show",
        buildShowPayload(items, position, opts)
      );
      if (!res?.success || !res.menuId) return null;
      const menuId = res.menuId;
      return new Promise((resolve) => {
        let offSelect = () => {
        };
        let offDismiss = () => {
        };
        const finish = (value) => {
          offSelect();
          offDismiss();
          resolve(value);
        };
        offSelect = bridge.on("menu:select", (payload) => {
          if (payload.menuId === menuId) finish(payload.itemId);
        });
        offDismiss = bridge.on("menu:dismiss", (payload) => {
          if (payload.menuId === menuId) finish(null);
        });
      });
    }
  };

  // src/bridge/namespaces/metadata.ts
  var _defaultMetadataLoggerOff = bridge.on(
    "metadata:writeComplete",
    (event2) => {
      if (event2 && event2.success === false) {
        console.warn("[fb.metadata] write failed:", {
          operation: event2.operation,
          path: event2.path,
          subsong: event2.subsong,
          status: event2.status,
          code: event2.code
        });
      }
    }
  );
  function disableDefaultMetadataLogger() {
    if (_defaultMetadataLoggerOff) {
      _defaultMetadataLoggerOff();
      _defaultMetadataLoggerOff = null;
    }
  }
  function metadataEmbedArtworkBytes(path, bytes, opts) {
    return bridge.invoke(
      "metadata.embedArtwork",
      {
        ...opts,
        path,
        imageData: bytesToBase64(bytes)
      }
    );
  }
  async function metadataEmbedArtworkFromDataUrl(path, dataUrl, opts) {
    const { mediaType, base64 } = parseBase64DataUrl(dataUrl);
    if (!mediaType.startsWith("image/")) {
      throw new TypeError("Expected an image Base64 data URL.");
    }
    return bridge.invoke(
      "metadata.embedArtwork",
      {
        ...opts,
        path,
        imageData: base64
      }
    );
  }
  var metadata = {
    /**
     * Read structured metadata for a single track.
     *
     * Returns `{ success, path, tags, info }`. `tags` preserves upstream
     * key casing and may hold a single string or a `string[]` per
     * multi-value field.
     *
     * For a track inside a container (CUE sheet, ISO image, multi-track
     * file), either append `|subsong:N` to `path` or pass
     * `opts.cueIndex`; the option wins when both are given. CUE track
     * numbering starts at 1.
     */
    read: (path, opts) => bridge.invoke("metadata.read", {
      path,
      ...opts || {}
    }),
    /**
     * Batch variant; returns a `results[]` array with one envelope entry
     * per requested path. Each path is resolved independently and may
     * carry its own `|subsong:N` suffix; there is no batch-wide
     * subsong option.
     */
    readBatch: (paths) => bridge.invoke("metadata.readBatch", { paths }),
    /**
     * Flat-form single-track read — every tag becomes a top-level field
     * alongside `success` / `path`. Keys use upstream casing (typically
     * UPPERCASE); the return shape is intentionally loose because the
     * C++ host forwards whatever tags the file happens to carry.
     * `canonicalPath` appears only on the file-open failure envelope.
     *
     * Container tracks are addressed the same way as `read()`.
     */
    readByPath: (path, opts) => bridge.invoke(
      "metadata.readByPath",
      {
        path,
        ...opts || {}
      }
    ),
    readRaw: (path, opts) => bridge.invoke("metadata.readRaw", {
      path,
      ...opts || {}
    }),
    /**
     * Cancellable, non-blocking batch probe. Reads happen on a host worker
     * thread, so a few hundred paths no longer stall the UI the way
     * `readBatch` does.
     *
     * Returns a `{ operationId, totalCount }` receipt immediately; the results
     * arrive in batches on `metadata:probeProgress` and are followed by
     * exactly one `metadata:probeComplete`. Each result reports where its info
     * came from (`infoSource: 'cached' | 'direct'`) and, on failure, which of
     * `'not-found'` / `'unsupported-format'` / `'read-error'` applies - the
     * distinction `readBatch` collapses into one generic error string.
     *
     * Paths may carry a `|subsong:N` suffix and are resolved independently;
     * they are echoed back verbatim so they work as lookup keys. Unlike
     * `metadata.read`, the batch surface does not honour the legacy `#N`
     * subsong spelling, which would mis-split an extensionless filename that
     * happens to end in `#<digits>`.
     *
     * Path validation is all-or-nothing: if any path fails the host's media
     * read check the whole call is rejected with `PERMISSION_DENIED` and no
     * `operationId` is produced. Per-path rejection is not available.
     *
     * @param paths Paths to probe; must not be empty.
     * @param opts `includeTags` (default `true`) attaches the flat tag map to
     *   each successful result. Pass `false` when only technical info is
     *   wanted.
     * @returns Dispatch receipt; the actual results arrive by event.
     */
    probeBatchAsync: (paths, opts) => bridge.invoke(
      "metadata.probeBatchAsync",
      { paths, ...opts || {} }
    ),
    /**
     * Stop a probe started by {@link metadata.probeBatchAsync}.
     *
     * Cancellation interrupts the in-progress disk read rather than waiting
     * for it, and the run always finishes with a `metadata:probeComplete`
     * carrying `cancelled: true`. Paths not yet reached are never reported,
     * and the interrupted path is reported as neither success nor failure.
     *
     * @param operationId The id from the `probeBatchAsync` receipt.
     * @returns `cancelled: false` when the operation had already finished or
     *   never existed.
     */
    cancelProbe: (operationId) => bridge.invoke("metadata.cancelProbe", {
      operationId
    }),
    /**
     * Async write — dispatches immediately and signals completion via
     * `metadata:writeComplete`. The receipt below describes the dispatch
     * envelope; the final outcome is on the event payload.
     */
    write: (path, tags, opts) => bridge.invoke("metadata.write", { path, tags, ...opts || {} }),
    writeBatch: (items) => bridge.invoke("metadata.writeBatch", { items }),
    /**
     * Write artwork into the audio file or alongside it.
     *
     * `opts.target` selects the destination:
     * - `"embedded"` (default) — write into the file's tag container via
     *   `album_art_editor`. Fails for formats the SDK cannot edit (e.g. CUE).
     * - `"file"` — write a sibling image file in the audio's directory using
     *   fb2k's external artwork naming (`cover.<ext>` / `back.<ext>` / ...).
     *   The extension is inferred from the image's magic bytes.
     * - `"all"` or `["embedded", "file"]` — run both targets and return a
     *   `results` map; top-level `success` is true when any target succeeded.
     *
     * `opts.filename` overrides the auto-generated sidecar name (file mode only).
     * Path separators or `..` sequences are rejected.
     *
     * CUE / subsong paths share one sidecar per directory — this matches
     * fb2k's per-directory external artwork lookup.
     */
    embedArtwork: (path, opts) => bridge.invoke(
      "metadata.embedArtwork",
      { path, ...opts || {} }
    ),
    removeEmbeddedArt: (path, opts) => bridge.invoke(
      "metadata.removeEmbeddedArt",
      { path, ...opts || {} }
    ),
    /** Removes a single tag field. */
    removeField: (path, field, opts) => bridge.invoke("metadata.removeField", {
      path,
      tags: [field],
      ...opts || {}
    }),
    removeTag: (path, tags, opts) => bridge.invoke("metadata.removeTag", { path, tags, ...opts || {} }),
    /** Embed exact image bytes without exposing the raw Base64 wire format. */
    embedArtworkBytes: metadataEmbedArtworkBytes,
    /** Embed a Base64 `data:image/*` URL; rejects malformed input. */
    embedArtworkFromDataUrl: metadataEmbedArtworkFromDataUrl,
    /** Detach the default failure logger; see {@link disableDefaultMetadataLogger}. */
    disableDefaultLogger: disableDefaultMetadataLogger
  };

  // src/bridge/namespaces/misc.ts
  var misc = {
    exit: () => bridge.invoke("misc.exit"),
    restart: () => bridge.invoke("misc.restart"),
    getComponentPath: () => bridge.invoke("misc.getComponentPath"),
    getFoobarPath: () => bridge.invoke("misc.getFoobarPath"),
    getProfilePath: () => bridge.invoke("misc.getProfilePath"),
    showConsole: () => bridge.invoke("misc.showConsole"),
    showLibrarySearch: (query) => bridge.invoke("misc.showLibrarySearch", {
      ...query ? { query } : {}
    }),
    showPopupMessage: (message, title) => bridge.invoke("misc.showPopupMessage", {
      message,
      ...title ? { title } : {}
    }),
    showPreferences: () => bridge.invoke("misc.showPreferences")
  };

  // src/bridge/namespaces/notification.ts
  var notification = {
    show: (opts) => bridge.invoke(
      "ui.showNotification",
      opts
    ),
    hide: () => bridge.invoke("ui.hideNotification"),
    showCustomMenu: (opts) => bridge.invoke("ui.showCustomMenu", opts),
    showToast: (opts) => bridge.invoke("ui.showToast", opts)
  };

  // src/bridge/namespaces/output.ts
  var output = {
    /**
     * Returns the flat list of available output devices. Internally the
     * C++ host wraps the array in a `{ devices, count }` envelope; this
     * wrapper unwraps it for ergonomic iteration.
     *
     * @throws Error when the host reports a failure envelope — the flat
     *         array return type leaves no channel to carry an error value.
     */
    getDevices: async () => {
      const response = await bridge.invoke(
        "output.getDevices"
      );
      if (response && response.success === false) {
        throw new Error(response.error ?? "output.getDevices failed");
      }
      return Array.isArray(response?.devices) ? response.devices : [];
    },
    getEntries: () => bridge.invoke("output.getEntries"),
    getSettings: () => bridge.invoke("output.getSettings")
  };

  // src/bridge/namespaces/panel.ts
  var panel = {
    getConfig: () => bridge.invoke("panel.getConfig"),
    setConfig: (opts) => bridge.invoke(
      "panel.setConfig",
      opts
    )
  };

  // src/bridge/namespaces/player.ts
  var player = {
    play: () => bridge.invoke("playback.play"),
    pause: () => bridge.invoke("playback.pause"),
    stop: () => bridge.invoke("playback.stop"),
    next: () => bridge.invoke("playback.next"),
    prev: () => bridge.invoke("playback.previous"),
    random: () => bridge.invoke("playback.random"),
    toggle: () => bridge.invoke("playback.playOrPause"),
    seek: (seconds) => bridge.invoke("playback.setPosition", {
      seconds
    }),
    getVolume: () => bridge.invoke("playback.getVolume"),
    setVolume: (volume) => bridge.invoke("playback.setVolume", { volume }),
    mute: () => bridge.invoke("playback.mute"),
    toggleMute: () => bridge.invoke("playback.toggleMute"),
    getState: () => bridge.invoke("playback.getState"),
    getCurrentTrack: () => bridge.invoke("playback.getCurrentTrack"),
    getPosition: () => bridge.invoke("playback.getPosition"),
    getOrder: () => bridge.invoke("playback.getPlaybackOrder"),
    setOrder: (order) => bridge.invoke(
      "playback.setPlaybackOrder",
      { order }
    ),
    getStopAfterCurrent: () => bridge.invoke(
      "playback.getStopAfterCurrent"
    ),
    setStopAfterCurrent: (enabled) => bridge.invoke("playback.setStopAfterCurrent", { enabled }),
    getCurrentTrackIndex: (includeTrackInfo) => bridge.invoke(
      "playback.getCurrentTrackIndex",
      { includeTrackInfo: !!includeTrackInfo }
    ),
    getPlayingPlaylist: () => bridge.invoke("playback.getPlayingPlaylist"),
    playPath: (path) => bridge.invoke("playback.playPath", { path }),
    /**
     * Begin playback of the supplied paths.
     *
     * Accepts either a single numeric `startIndex` matching the
     * original `(paths, startIndex)` signature or an options object
     * `{ startIndex?, replace? }` that additionally controls whether
     * the active playlist is cleared before insertion.
     *
     * @param paths - Absolute file paths. Each entry may carry a
     *                `|subsong:N` suffix for CUE tracks.
     * @param options - Numeric `startIndex` (0-based offset into the
     *                  active playlist), **or** an options object:
     *                  - `startIndex` selects the entry to start
     *                    playback from (0-based);
     *                  - `replace: true` clears the active playlist
     *                    before inserting; `false` (default) appends.
     */
    playPaths: ((paths, options) => {
      const opts = typeof options === "number" || options === void 0 ? { startIndex: options } : options;
      return bridge.invoke(
        "playback.playPaths",
        {
          paths,
          ...opts.startIndex != null ? { startIndex: opts.startIndex } : {},
          ...opts.replace != null ? { replace: opts.replace } : {}
        }
      );
    }),
    playPause: () => bridge.invoke("playback.playPause"),
    toggleStopAfterCurrent: () => bridge.invoke(
      "playback.toggleStopAfterCurrent"
    ),
    volumeUp: () => bridge.invoke("playback.volumeUp"),
    volumeDown: () => bridge.invoke("playback.volumeDown")
  };

  // src/bridge/namespaces/playcount.ts
  var playcount = {
    /**
     * Fetch the playcount entry for a single track.
     *
     * Internally batches into the registered `playcount.get` handler
     * (which requires `paths: string[]`) and unwraps the first result.
     * Resolves to `null` when the host returns an empty / failed envelope.
     */
    get: async (path) => {
      const r = await bridge.invoke("playcount.get", {
        paths: [path]
      });
      if (!r || r.success === false) return null;
      return r.results?.[0] ?? null;
    },
    /**
     * Batch fetch playcount entries for multiple tracks. Returns the full
     * envelope so callers can inspect the aggregate `count` field as well
     * as per-track `success` flags inside `results`.
     */
    getBatch: (paths) => bridge.invoke("playcount.getBatch", { paths }),
    /**
     * @deprecated foo_playcount does not currently expose a public API for
     * mutating playback statistics. The C++ handler is a placeholder that
     * always responds with `{success:false, error:"Direct playcount
     * modification not supported. Use rating.set for ratings."}`. The
     * `count` argument is retained for signature compatibility but is
     * not sent to the host (the handler never reads it). Use
     * `fb.rating.set` for rating mutation, or trigger play counts via
     * actual playback.
     */
    set: (path, count) => bridge.invoke("playcount.set", { path }),
    /** Aggregate library-wide playcount statistics. */
    getStats: () => bridge.invoke("playcount.getStats")
  };

  // src/bridge/namespaces/playlist.ts
  var playlist = {
    // === Basic operations ===
    getAll: () => bridge.invoke("playlist.getAll"),
    getActive: () => bridge.invoke("playlist.getActive"),
    setActive: (index) => bridge.invoke("playlist.setActive", { playlist: index }),
    getPlaying: () => bridge.invoke("playlist.getPlaying"),
    /**
     * Fetch a slice of tracks from a playlist.
     *
     * The host returns a page envelope
     * `{ playlist, start, count, total, tracks }`; this wrapper unwraps
     * `tracks` and resolves with `PlaylistTrack[]` so callers can iterate
     * the result directly.
     *
     * Callers that need pagination metadata (`total` etc.) should hit
     * the bridge directly:
     *   `bridge.invoke<PlaylistTracksResponse>('playlist.getTracks', …)`.
     */
    getTracks: async (index, start, count, formats) => {
      const response = await bridge.invoke(
        "playlist.getTracks",
        {
          playlist: index,
          start,
          count,
          ...formats && Object.keys(formats).length ? { formats } : {}
        }
      );
      return Array.isArray(response?.tracks) ? response.tracks : [];
    },
    getCount: (index) => bridge.invoke("playlist.getTrackCount", {
      playlist: index
    }),
    create: (name, options) => bridge.invoke("playlist.create", {
      name,
      ...options && typeof options === "object" ? options : {}
    }),
    remove: (index) => bridge.invoke("playlist.remove", { playlist: index }),
    rename: (index, name) => bridge.invoke("playlist.rename", {
      playlist: index,
      name
    }),
    duplicate: (index) => bridge.invoke("playlist.duplicate", {
      playlist: index
    }),
    clear: (index) => bridge.invoke("playlist.clear", {
      playlist: index
    }),
    // === Track addition ===
    /**
     * Add the given paths to the playlist. Each path/URL is capped at
     * 2048 chars (`INTERNET_MAX_URL_LENGTH`); over-length items are
     * silently skipped and counted in `invalidCount`.
     */
    add: (index, paths) => bridge.invoke("playlist.addPaths", {
      playlist: index,
      paths
    }),
    /**
     * Asynchronously add the given paths to the playlist. Each path/URL
     * is capped at 2048 chars; over-length items are silently skipped
     * and counted in `invalidCount`.
     */
    addAsync: (index, paths) => bridge.invoke(
      "playlist.addPathsAsync",
      { playlist: index, paths }
    ),
    /**
     * Sequentially add the given paths to the playlist one-by-one. Each
     * path/URL is capped at 2048 chars; over-length items are silently
     * skipped.
     */
    addSequential: (index, paths) => bridge.invoke(
      "playlist.addPathsSequential",
      { playlist: index, paths }
    ),
    /**
     * Add tracks to the playlist via metadb handles. Each underlying
     * path is capped at 2048 chars; over-length items are silently
     * skipped and counted in `invalidCount`.
     */
    addHandles: (index, handles) => bridge.invoke("playlist.addHandles", {
      playlist: index,
      handles
    }),
    insertTracks: (index, insertIndex, handles) => bridge.invoke("playlist.insertTracks", {
      playlist: index,
      position: insertIndex,
      handles
    }),
    // === Track removal ===
    removeTracks: (index, indices) => bridge.invoke("playlist.removeTracks", {
      playlist: index,
      items: indices
    }),
    removeSelectedTracks: (index) => bridge.invoke("playlist.removeSelectedTracks", {
      playlist: index
    }),
    // === Playback control ===
    playTrack: (index, trackIndex, options) => bridge.invoke("playlist.playTrack", {
      playlist: index,
      index: trackIndex,
      ...options
    }),
    // === Focused track ===
    getFocused: (index) => bridge.invoke(
      "playlist.getFocusedTrack",
      { playlist: index }
    ),
    setFocused: (index, trackIndex) => bridge.invoke("playlist.setFocusedTrack", {
      playlist: index,
      index: trackIndex
    }),
    // === Selection ===
    getSelection: (index) => bridge.invoke("playlist.getSelection", {
      playlist: index
    }),
    /**
     * Fetch the currently selected tracks of a playlist.
     *
     * Same envelope-unwrap pattern as {@link getTracks}; the C++ handler
     * returns `{ success, playlist, count, tracks }` and this wrapper
     * surfaces only `tracks` to keep the iteration ergonomic.
     */
    getSelectedTracks: async (index) => {
      const response = await bridge.invoke(
        "playlist.getSelectedTracks",
        { playlist: index }
      );
      return Array.isArray(response?.tracks) ? response.tracks : [];
    },
    setSelection: (index, indices, clearOthers = true) => bridge.invoke("playlist.setSelection", {
      playlist: index,
      indices,
      clearOthers
    }),
    selectAll: (index) => bridge.invoke("playlist.selectAll", { playlist: index }),
    deselectAll: (index) => bridge.invoke("playlist.deselectAll", {
      playlist: index
    }),
    // === Move and sort tracks ===
    moveTracks: (index, indices, delta) => bridge.invoke("playlist.moveTracks", {
      playlist: index,
      items: indices,
      delta
    }),
    reorder: (index, order) => bridge.invoke("playlist.reorder", {
      playlist: index,
      newOrder: order
    }),
    sort: (index, pattern, descending = false, selectedOnly = false) => bridge.invoke("playlist.sort", {
      playlist: index,
      pattern,
      descending,
      selectedOnly
    }),
    shuffle: (index) => bridge.invoke("playlist.shuffle", { playlist: index }),
    reverse: (index) => bridge.invoke("playlist.reverse", { playlist: index }),
    // === Undo and redo ===
    undo: (index) => bridge.invoke("playlist.undo", { playlist: index }),
    redo: (index) => bridge.invoke("playlist.redo", { playlist: index }),
    // === Autoplaylist ===
    isAutoplaylist: (index) => bridge.invoke("playlist.isAutoplaylist", {
      playlist: index
    }),
    getAutoplaylistInfo: (index) => bridge.invoke(
      "playlist.getAutoplaylistInfo",
      { playlist: index }
    ),
    getAutoplaylistQuery: (index) => bridge.invoke("playlist.getAutoplaylistQuery", {
      playlist: index
    }),
    createAutoplaylist: (name, query, sort, keepSorted) => bridge.invoke("playlist.createAutoplaylist", {
      name,
      query,
      sort,
      keepSorted: !!keepSorted
    }),
    convertToAutoplaylist: (index, query, sort, keepSorted) => bridge.invoke("playlist.convertToAutoplaylist", {
      playlist: index,
      query,
      sort,
      keepSorted: !!keepSorted
    }),
    removeAutoplaylist: (index) => bridge.invoke(
      "playlist.removeAutoplaylist",
      { playlist: index }
    ),
    // === Lock state ===
    isLocked: (index) => bridge.invoke("playlist.isLocked", {
      playlist: index
    }),
    getLockInfo: (index) => bridge.invoke("playlist.getLockInfo", {
      playlist: index
    }),
    // === Playlist reordering ===
    reorderPlaylists: (order) => bridge.invoke(
      "playlist.reorderPlaylists",
      { newOrder: order }
    ),
    // === Advanced operations ===
    replaceAllAndPlay: (options) => bridge.invoke(
      "playlist.replaceAllAndPlay",
      options
    ),
    // === Column definitions ===
    getAvailableColumns: () => bridge.invoke(
      "playlist.getAvailableColumns"
    ),
    // === Focused track (namespace supplement) ===
    focusTrack: (index, trackIndex) => bridge.invoke("playlist.focusTrack", {
      playlist: index,
      index: trackIndex
    }),
    getPlaylistCount: () => bridge.invoke("playlist.getCount"),
    getFocusTrack: (index) => bridge.invoke(
      "playlist.getFocusTrack",
      { playlist: index }
    )
  };

  // src/bridge/namespaces/port.ts
  var port = {
    connect: (name) => bridge.invoke("port.connect", { name }),
    disconnect: (portId) => bridge.invoke("port.disconnect", { portId }),
    postMessage: (portId, message) => bridge.invoke("port.postMessage", { portId, message }),
    postMessageTo: (portId, targetPortId, message) => bridge.invoke("port.postMessageTo", {
      portId,
      targetPortId,
      message
    }),
    getPorts: (name) => bridge.invoke("port.getPorts", { name }),
    onMessage: (handler) => bridge.on("port:message", handler),
    onDisconnect: (handler) => bridge.on("port:disconnected", handler),
    onConnect: (handler) => bridge.on("port:connected", handler)
  };

  // src/bridge/namespaces/queue.ts
  var queue = {
    get: () => bridge.invoke("queue.get"),
    getCount: () => bridge.invoke("queue.getCount"),
    add: (opts) => bridge.invoke("queue.add", opts),
    /**
     * Add the given paths to the play queue. Each path/URL is capped at
     * 2048 chars; over-length items are silently skipped and counted in
     * `invalidCount`.
     */
    addPaths: (paths, opts) => bridge.invoke("queue.addPaths", {
      paths,
      ...opts || {}
    }),
    remove: (index) => bridge.invoke("queue.remove", { index }),
    moveToTop: (index) => bridge.invoke("queue.moveToTop", { index }),
    flush: () => bridge.invoke("queue.flush"),
    clear: () => bridge.invoke("queue.clear")
  };

  // src/bridge/namespaces/rating.ts
  var rating = {
    /**
     * Resolve the 0-5 integer rating stored for the track at `path`.
     *
     * @param path - Absolute file path. May carry a `|subsong:N`
     *               suffix; the host extracts the CUE index.
     */
    get: (path) => bridge.invoke("rating.get", { path }),
    /**
     * Set the 0-5 integer rating for the track at `path`.
     *
     * @param path - Absolute file path. May carry a `|subsong:N`
     *               suffix for CUE entries; the host extracts the
     *               index automatically.
     * @param rating - Integer in `[0, 5]`. `0` clears the rating.
     * @param opts.cueIndex - Explicit CUE subsong index. Takes
     *                        precedence over any `|subsong:N` suffix
     *                        in `path`. Useful when the caller tracks
     *                        subsong indices independently from the
     *                        path string.
     */
    set: (path, rating2, opts) => bridge.invoke("rating.set", {
      path,
      rating: rating2,
      ...opts?.cueIndex != null ? { cueIndex: opts.cueIndex } : {}
    })
  };

  // src/bridge/namespaces/replaygain.ts
  var replaygain = {
    /** Accepts a single path or an array; always sent as `{ paths: string[] }`. */
    get: (paths) => bridge.invoke("replaygain.get", {
      paths: Array.isArray(paths) ? paths : [paths]
    }),
    getMode: () => bridge.invoke("replaygain.getMode"),
    setMode: (sourceMode, processingMode) => bridge.invoke(
      "replaygain.setMode",
      {
        sourceMode,
        ...processingMode ? { processingMode } : {}
      }
    ),
    getPreamp: () => bridge.invoke("replaygain.getPreamp"),
    setPreamp: (withRg, withoutRg) => bridge.invoke(
      "replaygain.setPreamp",
      {
        ...withRg != null ? { withRg } : {},
        ...withoutRg != null ? { withoutRg } : {}
      }
    ),
    getSettings: () => bridge.invoke("replaygain.getSettings"),
    /**
     * Trigger a ReplayGain scan over the given paths via the host's
     * context-menu pipeline.
     *
     * @param paths - Absolute file paths to scan. Empty array is a
     *                no-op that resolves with `success: false`.
     * @param opts.mode - `'track'` (default) scans per-file track gain;
     *                    `'album'` treats the selection as a single
     *                    album. Maps to the host's "Scan per-file
     *                    track gain" and "Scan selection as a single
     *                    album" menu entries respectively.
     */
    scan: (paths, opts) => bridge.invoke(
      "replaygain.scan",
      {
        paths,
        ...opts?.mode ? { mode: opts.mode } : {}
      }
    ),
    clear: (paths) => bridge.invoke(
      "replaygain.clear",
      { paths }
    )
  };

  // src/bridge/namespaces/selection.ts
  var selection = {
    get: (opts) => bridge.invoke("selection.get", opts || {}),
    getType: () => bridge.invoke("selection.getType"),
    set: (handles) => bridge.invoke(
      "selection.set",
      { handles }
    ),
    /** Tracking source: `'selection'` (default) or `'playlist'`. */
    setPlaylistTracking: (mode = "selection") => bridge.invoke("selection.setPlaylistTracking", { mode }),
    getViewerMode: () => bridge.invoke("selection.getViewerMode"),
    getViewingTrack: (opts) => bridge.invoke(
      "selection.getViewingTrack",
      opts || {}
    )
  };

  // src/bridge/namespaces/sharedState.ts
  var sharedState = {
    get: (key) => bridge.invoke("state.get", { key }),
    set: (key, value, silent = false, ttlMs) => bridge.invoke("state.set", {
      key,
      value,
      silent,
      ...ttlMs != null ? { ttlMs } : {}
    }),
    delete: (key) => bridge.invoke("state.delete", { key }),
    keys: (pattern = "*") => bridge.invoke("state.keys", { pattern }),
    onChange: (handler) => bridge.on("state:changed", handler),
    onDelete: (handler) => bridge.on("state:deleted", handler)
  };

  // src/bridge/namespaces/shell.ts
  var shell = {
    showInExplorer: (path) => bridge.invoke("shell.showInExplorer", { path }),
    openWith: (path) => bridge.invoke("shell.openWith", { path }),
    openExternal: (url) => bridge.invoke("shell.openExternal", { url }),
    exec: (command, options) => bridge.invoke("shell.exec", { command, ...options }),
    spawn: (executable, options) => {
      const opts = { executable, ...options };
      if (opts.cwd && typeof opts.cwd === "string" && opts.cwd.trim() === "") {
        return Promise.resolve({
          success: false,
          error: "cwd is empty string"
        });
      }
      return bridge.invoke("shell.spawn", opts);
    }
  };

  // src/bridge/namespaces/system.ts
  var system = {
    listApis: (includeInternal, includeExternal) => bridge.invoke("system.listAvailableApis", {
      includeInternal,
      includeExternal
    }),
    getApisByNamespace: (namespace) => bridge.invoke("system.getApisByNamespace", {
      namespace
    }),
    searchApis: (query) => bridge.invoke("system.searchApis", { query }),
    getApiStats: () => bridge.invoke("system.getApiStats"),
    getRegisteredPlugins: () => bridge.invoke("system.getRegisteredPlugins"),
    isPluginRegistered: (namespace) => bridge.invoke("system.isPluginRegistered", {
      namespace
    }),
    getDPI: () => bridge.invoke("system.getDPI"),
    getLocale: () => bridge.invoke("system.getLocale"),
    getTheme: () => bridge.invoke("system.getTheme")
  };

  // src/bridge/namespaces/taskbar.ts
  var taskbar = {
    /**
     * Install the thumbnail toolbar (max 7 buttons). Windows permits this only
     * once per window; use {@link updateButton} afterwards to change state.
     */
    setThumbnailButtons: (buttons) => bridge.invoke("taskbar.setThumbnailButtons", { buttons }),
    /** Update one existing thumbnail button in place (cannot add or remove buttons). */
    updateButton: (opts) => bridge.invoke("taskbar.updateButton", opts),
    /**
     * Set the taskbar progress bar. `value` (range 0-1) applies to the
     * `'normal'` / `'error'` / `'paused'` states.
     */
    setProgress: (opts) => bridge.invoke("taskbar.setProgress", opts),
    /** Set or clear the overlay badge icon; omit `icon` to clear it. */
    setOverlayIcon: (opts = {}) => bridge.invoke("taskbar.setOverlayIcon", opts),
    /** Flash the taskbar button. `count` defaults to 3, `interval` (ms) to the system default. */
    flash: (opts = {}) => bridge.invoke("taskbar.flash", opts)
  };

  // src/bridge/namespaces/titleformat.ts
  var titleformat = {
    /**
     * Evaluate a single pattern against one track.
     *
     * `infoAvailable: false` means the track's metadb info was not ready,
     * so tag-derived output is untrustworthy. See the SDK docs for what
     * the flag does not cover.
     */
    eval: (pattern, path) => bridge.invoke("titleformat.eval", {
      pattern,
      ...path ? { path } : {}
    }),
    /**
     * Batch variant of `eval()`. Each row carries its own
     * `infoAvailable` flag; rows that failed omit it.
     */
    evalBatch: (pattern, paths) => bridge.invoke("titleformat.evalBatch", {
      pattern,
      paths
    }),
    /**
     * Evaluate one or more named patterns against a single track. The
     * `fields` argument maps each output key to a titleformat pattern
     * string (e.g. `{ artist: '%artist%', year: '$year(%date%)' }`).
     *
     * `infoAvailable: false` means tag-derived values are untrustworthy.
     * One flag covers the whole merged script and never covers
     * foo_playcount virtual fields — see the SDK docs for the full
     * limitation. A `fields` key named `infoAvailable` overwrites the
     * flag, matching the existing behaviour of `path` and `success`.
     */
    evalFields: (path, fields) => bridge.invoke("titleformat.evalFields", {
      path,
      fields
    }),
    /**
     * Batch variant of {@link evalFields}. Compiles the merged pattern
     * once and applies it to every path — host-side optimisation gives
     * roughly 10× speedup vs. calling {@link evalFields} per track.
     *
     * Each row carries its own `infoAvailable` flag with the same meaning
     * and the same merged-script limitation as {@link evalFields}.
     */
    evalFieldsBatch: (paths, fields) => bridge.invoke(
      "titleformat.evalFieldsBatch",
      { paths, fields }
    ),
    getBuiltinFields: () => bridge.invoke("titleformat.getBuiltinFields")
  };

  // src/bridge/namespaces/tray.ts
  var tray = {
    /** Create the tray icon. Must be called once before any other `tray.*` API. */
    create: (opts = {}) => bridge.invoke("tray.create", opts),
    /** Remove the tray icon. */
    destroy: () => bridge.invoke("tray.destroy", {}),
    /** Replace the tray icon image; omit or pass null to fall back to the main icon. */
    setIcon: (icon) => bridge.invoke("tray.setIcon", { icon }),
    /** Update the hover tooltip (max 128 characters). */
    setTooltip: (tooltip) => bridge.invoke("tray.setTooltip", { tooltip }),
    /** Show a balloon notification. `icon` is `'info'` (default) / `'warning'` / `'error'`. */
    showBalloon: (opts) => bridge.invoke("tray.showBalloon", opts),
    /**
     * Set the full context menu, replacing items in the zone determined by
     * `config.customPosition` (default `'top'`). The other two zones are left
     * intact. Use the incremental helpers below for partial updates.
     */
    setContextMenu: (items, config2) => bridge.invoke(
      "tray.setContextMenu",
      config2 ? { items, config: config2 } : { items }
    ),
    /** Hide to the tray instead of the taskbar when the window is minimized. */
    setMinimizeToTray: (enabled) => bridge.invoke("tray.setMinimizeToTray", { enabled }),
    /** Hide to the tray instead of quitting when the window is closed. */
    setCloseToTray: (enabled) => bridge.invoke("tray.setCloseToTray", { enabled }),
    /** Resolve whether the tray icon currently exists. */
    isVisible: () => bridge.invoke("tray.isVisible", {}),
    /** Append items to the given zone (default `'top'`). */
    appendMenuItems: (items, position = "top") => bridge.invoke("tray.appendMenuItems", { items, position }),
    /** Remove items with the given ids from all zones. Resolves with the number removed. */
    removeMenuItems: (ids) => bridge.invoke("tray.removeMenuItems", { ids }),
    /** Clear the given zone, or all zones if `position` is omitted. */
    clearMenuItems: (position) => bridge.invoke(
      "tray.clearMenuItems",
      position ? { position } : {}
    ),
    /**
     * Get all user-defined menu items, flattened in zone order
     * (`top -> playback -> bottom`). Built-in items injected by
     * `showPlaybackControls` / `showSystemItems` are **not** included.
     */
    getMenuItems: () => bridge.invoke("tray.getMenuItems", {}),
    /**
     * Update a single menu item's `checked` / `enabled` state in place. The id
     * is searched across all zones and recursively into submenus. At least one
     * of `checked` / `enabled` must be supplied. This is a granular alternative
     * to {@link setContextMenu}, which performs a full-zone replace.
     *
     * Providing `checked` (true or false) marks the item checkable so subsequent
     * `getMenuItems()` and the WebView overlay keep checkbox semantics even when
     * the value is `false`.
     *
     * The native tray menu is rebuilt from stored data each time it is opened,
     * so the new state takes effect on the **next** open rather than mutating a
     * menu that is already showing. The resolved `found` flag reports whether an
     * item with the given id existed.
     */
    setMenuItemState: (id, state2) => bridge.invoke(
      "tray.setMenuItemState",
      { id, ...state2 }
    )
  };

  // src/bridge/namespaces/ui.ts
  var ui = {
    // === Basic window controls ===
    minimize: () => bridge.invoke("window.minimize"),
    maximize: () => bridge.invoke("window.maximize"),
    restore: () => bridge.invoke("window.restore"),
    close: () => bridge.invoke("window.close"),
    toggleMaximize: () => bridge.invoke(
      "window.toggleMaximize"
    ),
    startDrag: () => bridge.invoke("window.startDrag"),
    startResize: (edge) => bridge.invoke("window.startResize", { edge }),
    reload: () => bridge.invoke("window.reload"),
    // === State queries ===
    getState: () => bridge.invoke("window.getState"),
    isMaximized: () => bridge.invoke("window.isMaximized"),
    /** Resolves with `{ minimized }` (the host does not send an `isMinimized` alias). */
    isMinimized: () => bridge.invoke("window.isMinimized"),
    isFullscreen: () => bridge.invoke("window.isFullscreen"),
    /** Resolves with `{ enabled, isAlwaysOnTop }` (both carry the same value). */
    isAlwaysOnTop: () => bridge.invoke("window.isAlwaysOnTop"),
    isResizable: () => bridge.invoke("window.isResizable"),
    getTitle: () => bridge.invoke("window.getTitle"),
    getMode: () => bridge.invoke("window.getMode"),
    // === Position and size ===
    setPosition: (x, y) => bridge.invoke("window.setPosition", { x, y }),
    setSize: (width, height) => bridge.invoke("window.setSize", { width, height }),
    setTitle: (title) => bridge.invoke("window.setTitle", { title }),
    getBounds: () => bridge.invoke("window.getBounds"),
    setBounds: (opts) => bridge.invoke("window.setBounds", opts),
    center: () => bridge.invoke("window.center"),
    hasSavedBounds: () => bridge.invoke("window.hasSavedBounds"),
    // === Size constraints ===
    setMinSize: (width, height) => bridge.invoke("window.setMinSize", { width, height }),
    getMinSize: () => bridge.invoke("window.getMinSize"),
    setMaxSize: (width, height) => bridge.invoke("window.setMaxSize", { width, height }),
    getMaxSize: () => bridge.invoke("window.getMaxSize"),
    setResizable: (resizable) => bridge.invoke("window.setResizable", { resizable }),
    // === Always-on-top ===
    setAlwaysOnTop: (enabled) => bridge.invoke("window.setAlwaysOnTop", { enabled }),
    toggleAlwaysOnTop: () => bridge.invoke(
      "window.toggleAlwaysOnTop"
    ),
    // === Fullscreen ===
    toggleFullscreen: () => bridge.invoke(
      "window.toggleFullscreen"
    ),
    enterFullscreen: () => bridge.invoke(
      "window.enterFullscreen"
    ),
    exitFullscreen: () => bridge.invoke(
      "window.exitFullscreen"
    ),
    setFullscreen: (enabled) => bridge.invoke(
      "window.setFullscreen",
      { enabled }
    ),
    // === Focus ===
    focus: (windowId) => bridge.invoke(
      "window.focus",
      windowId ? { windowId } : {}
    ),
    blur: () => bridge.invoke("window.blur"),
    flash: (opts) => bridge.invoke("window.flash", opts),
    flashTaskbar: (count) => bridge.invoke("window.flashTaskbar", {
      ...count != null ? { count } : {}
    }),
    showSystemMenu: (x, y, w, h) => bridge.invoke("window.showSystemMenu", {
      x,
      y,
      ...w != null ? { w, h } : {}
    }),
    // === DWM effects ===
    setMica: (opts = {}) => bridge.invoke("window.setMica", opts),
    setMicaEffect: (opts = {}) => bridge.invoke("window.setMicaEffect", opts),
    setAcrylic: (opts) => bridge.invoke("window.setAcrylic", opts),
    setBlur: (opts) => bridge.invoke("window.setBlur", opts),
    setDarkMode: (enabled) => bridge.invoke("window.setDarkMode", { enabled }),
    setBackgroundTransparency: (opts) => bridge.invoke(
      "window.setBackgroundTransparency",
      opts
    ),
    refreshWebView: () => bridge.invoke("window.refreshWebView"),
    setCornerPreference: (mode) => bridge.invoke("window.setCornerPreference", { mode }),
    getCornerPreference: () => bridge.invoke("window.getCornerPreference"),
    // === Titlebar ===
    getTitlebarHeight: () => bridge.invoke("window.getTitlebarHeight"),
    setTitlebarHeight: (height) => bridge.invoke("window.setTitlebarHeight", { height }),
    getCaptionButtonsWidth: () => bridge.invoke("window.getCaptionButtonsWidth"),
    getTitlebarInfo: () => bridge.invoke("window.getTitlebarInfo"),
    setDragRegions: (regions) => bridge.invoke(
      "window.setDragRegions",
      { regions }
    ),
    clearDragRegions: () => bridge.invoke("window.clearDragRegions"),
    setNoDragRegions: (regions) => bridge.invoke(
      "window.setNoDragRegions",
      { regions }
    ),
    clearNoDragRegions: () => bridge.invoke("window.clearNoDragRegions"),
    setFrameless: (frameless) => bridge.invoke("window.setFrameless", { frameless }),
    // === Multi-window ===
    createPopup: (opts) => bridge.invoke("window.createPopup", opts),
    closePopup: (windowId) => bridge.invoke("window.closePopup", { windowId }),
    closeAllPopups: () => bridge.invoke("window.closeAllPopups"),
    getAllWindows: () => bridge.invoke("window.getAllWindows"),
    getCurrentWindowId: () => bridge.invoke("window.getCurrentWindowId"),
    getPopupBehavior: (windowId) => bridge.invoke("window.getPopupBehavior", {
      ...windowId != null ? { windowId } : {}
    }),
    setPopupBehavior: (opts) => bridge.invoke(
      "window.setPopupBehavior",
      opts
    ),
    getBackdropPolicy: (windowId) => bridge.invoke("window.getBackdropPolicy", {
      ...windowId != null ? { windowId } : {}
    }),
    setBackdropPolicy: (opts) => bridge.invoke(
      "window.setBackdropPolicy",
      {
        ...opts.windowId != null ? { windowId: opts.windowId } : {},
        backdropPolicy: Object.fromEntries(
          Object.entries(opts).filter(([key]) => key !== "windowId")
        )
      }
    ),
    setClickThrough: (opts) => bridge.invoke(
      "window.setClickThrough",
      opts
    ),
    isClickThrough: (windowId) => bridge.invoke("window.isClickThrough", {
      ...windowId != null ? { windowId } : {}
    }),
    setClickThroughExcludeRegions: (opts) => bridge.invoke("window.setClickThroughExcludeRegions", opts),
    clearClickThroughExcludeRegions: (windowId) => bridge.invoke(
      "window.clearClickThroughExcludeRegions",
      { ...windowId != null ? { windowId } : {} }
    ),
    sendMessage: (targetWindowId, message) => bridge.invoke("window.sendMessage", {
      targetWindowId,
      message
    }),
    broadcast: (message) => bridge.invoke("window.broadcast", { message }),
    cancelClose: () => bridge.invoke("window.cancelClose"),
    confirmClose: () => bridge.invoke("window.confirmClose"),
    // === Zoom and DPI ===
    getDpiScale: () => bridge.invoke("window.getDpiScale"),
    setZoom: (zoom) => bridge.invoke("window.setZoom", { zoom }),
    getZoom: () => bridge.invoke("window.getZoom"),
    resetZoom: () => bridge.invoke("window.resetZoom"),
    setZoomForDpi: (dpi) => bridge.invoke(
      "window.setZoomForDpi",
      { ...dpi != null ? { dpi } : {} }
    ),
    // === Dev server ===
    getDevServerConfig: () => bridge.invoke("window.getDevServerConfig"),
    setDevServerConfig: (opts) => bridge.invoke("window.setDevServerConfig", opts),
    showContextMenu: (x, y) => bridge.invoke("ui.showContextMenu", {
      ...x != null ? { x, y } : {}
    })
  };

  // src/bridge/namespaces/utils.ts
  var utils = {
    ping: () => bridge.invoke("test.ping"),
    echo: (message) => bridge.invoke("test.echo", { message }),
    /** Façade over `titleformat.eval`. */
    formatTitle: (pattern, path) => bridge.invoke("titleformat.eval", {
      pattern,
      path
    }),
    /** Façade over `metadata.read`. */
    getFileInfo: (path) => bridge.invoke("metadata.read", { path })
  };

  // src/bridge/index.ts
  var fb = {
    // Reactive state mirror
    state,
    // Event subscription surface
    on: bridge.on.bind(bridge),
    off: bridge.off.bind(bridge),
    once: bridge.once.bind(bridge),
    // Direct invoke escape hatch
    invoke: bridge.invoke.bind(bridge),
    // Availability probes
    isAvailable: () => bridge.isAvailable,
    ready: () => bridge.ready(),
    // Namespaces (alphabetical)
    artwork,
    audio,
    clipboard,
    config,
    console: consoleApi,
    cursor,
    dialog,
    discovery,
    dnd,
    dsp,
    event,
    file,
    http,
    jitQueue,
    keyboard,
    library,
    log,
    lyrics,
    menu,
    metadata,
    misc,
    notification,
    output,
    panel,
    playcount,
    player,
    playlist,
    port,
    queue,
    rating,
    replaygain,
    selection,
    sharedState,
    shell,
    system,
    taskbar,
    titleformat,
    tray,
    ui,
    utils
  };
  var bridge_default = fb;

  // src/bridge/iife.ts
  var iife_default = bridge_default;

  return iife_default;

})();
//# sourceMappingURL=bridge.global.js.map
//# sourceMappingURL=bridge.global.js.map