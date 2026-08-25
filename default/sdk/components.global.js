var __fbComponents = (function () {
  'use strict';

  // src/components/runtime.ts
  var _cached = null;
  function getFb() {
    if (_cached) return _cached;
    if (typeof window === "undefined") {
      throw new Error(
        "foo-webview-sdk components: not running in a browser context (window is undefined)."
      );
    }
    const w = window;
    if (!w.fb) {
      throw new Error(
        "foo-webview-sdk components: window.fb is missing. Load bridge.global.js (or import the bridge entry) before mounting fb-* components."
      );
    }
    _cached = w.fb;
    return _cached;
  }

  // src/components/FbBaseElement.ts
  var _FbBaseElement = class _FbBaseElement extends HTMLElement {
    constructor() {
      super();
      /**
       * Unsubscribe callbacks returned by `fb.on(...)`. Drained on
       * `disconnectedCallback`; intentionally `protected` so subclasses
       * can prepend additional cleanups in edge cases.
       */
      this._subscriptions = [];
      /**
       * `AbortController` whose `signal` is forwarded to every DOM
       * listener registered via {@link FbBaseElement._listen}.
       * `disconnectedCallback` calls `abort()` to detach all listeners
       * in one shot, then replaces the controller so a subsequent
       * `connectedCallback` (re-attach) starts with a fresh signal.
       */
      this._abortController = new AbortController();
      /**
       * `true` once {@link FbBaseElement._buildDOM} has finished. Useful
       * for subclasses that schedule async work and need to no-op before
       * the Shadow DOM is ready.
       */
      this._domReady = false;
      this.attachShadow({ mode: "open" });
    }
    connectedCallback() {
      this._buildDOM();
      this._domReady = true;
      this._setupEvents();
      this._subscribe();
    }
    disconnectedCallback() {
      for (const off of this._subscriptions) {
        try {
          off();
        } catch {
        }
      }
      this._subscriptions.length = 0;
      this._abortController.abort();
      this._abortController = new AbortController();
    }
    /** Subclass hook — build Shadow DOM exactly once per attachment. */
    _buildDOM() {
    }
    /** Subclass hook — bind DOM event listeners (use {@link _listen}). */
    _setupEvents() {
    }
    /** Subclass hook — register fb event subscriptions (use {@link _sub}). */
    _subscribe() {
    }
    _sub(event, handler) {
      this._subscriptions.push(getFb().on(event, handler));
    }
    /**
     * Add a DOM listener whose lifetime is tied to
     * {@link _abortController}. No manual `removeEventListener` is
     * needed — the listener is auto-detached on `disconnectedCallback`.
     */
    _listen(target, event, handler, options = {}) {
      target.addEventListener(event, handler, {
        ...options,
        signal: this._abortController.signal
      });
    }
    /**
     * Dispatch a CustomEvent that bubbles through the Shadow DOM
     * boundary (`composed: true`). All `fb-*` events follow this
     * pattern so theme code can listen at any ancestor.
     */
    _emit(name, detail, cancelable = false) {
      return this.dispatchEvent(
        new CustomEvent(name, {
          bubbles: true,
          composed: true,
          cancelable,
          detail
        })
      );
    }
    /** Shadow-root scoped `querySelector` shortcut. */
    _$(sel) {
      return this.shadowRoot?.querySelector(sel) ?? null;
    }
    /** Shadow-root scoped `querySelectorAll` shortcut. */
    _$$(sel) {
      const root = this.shadowRoot;
      if (!root) {
        return document.createDocumentFragment().querySelectorAll(sel);
      }
      return root.querySelectorAll(sel);
    }
    /**
     * HTML-escape a value for safe innerHTML interpolation. Escapes
     * `&`, `<`, `>`, and `"` to their named entities.
     */
    _escHtml(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    static get baseCSS() {
      if (!_FbBaseElement._baseCSSCache) {
        _FbBaseElement._baseCSSCache = ":host{display:inline-flex;box-sizing:border-box}:host([hidden]){display:none}button{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}button:disabled{cursor:not-allowed;pointer-events:none}";
      }
      return _FbBaseElement._baseCSSCache;
    }
  };
  /**
   * Cached structural CSS shared by every component. Intentionally
   * minimal: layout primitives + button reset only.
   */
  _FbBaseElement._baseCSSCache = null;
  var FbBaseElement = _FbBaseElement;

  // src/components/FbConsole.ts
  var FbConsole = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._maxLines = 200;
      this._autoScroll = true;
      this._interval = null;
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:block;overflow-y:auto}div[part=line]{white-space:pre-wrap}</style><div part="container"></div>`;
      this._container = this._$("[part=container]");
      this._maxLines = parseInt(this.getAttribute("max-lines") || "", 10) || 200;
      this._autoScroll = this.getAttribute("auto-scroll") !== "false";
    }
    _setupEvents() {
    }
    _subscribe() {
      void this._loadLog();
      const refreshMs = parseInt(this.getAttribute("refresh") || "", 10) || 1e3;
      this._interval = setInterval(() => {
        void this._loadLog();
      }, refreshMs);
    }
    disconnectedCallback() {
      if (this._interval) clearInterval(this._interval);
      this._interval = null;
      super.disconnectedCallback();
    }
    async _loadLog() {
      try {
        const result = await getFb().log.read(this._maxLines);
        if (!result?.success) return;
        const lines = result.lines || [];
        this._container.innerHTML = lines.map(
          (line) => `<div part="line">${this._escHtml(line)}</div>`
        ).join("");
        if (this._autoScroll) {
          this._container.scrollTop = this._container.scrollHeight;
        }
        this._emit("fb-console-update", {
          lineCount: lines.length
        });
      } catch {
      }
    }
  };

  // src/components/FbCoverArt.ts
  var FbCoverArt = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._debounceTimer = null;
    }
    static get observedAttributes() {
      return ["type", "use-fb2k"];
    }
    attributeChangedCallback() {
      if (!this._domReady) return;
      void this._loadCover();
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:inline-block;overflow:hidden}[part=container]{position:relative;width:100%;height:100%}[part=image]{display:block;width:100%;height:100%;object-fit:cover}</style><div part="container"><img part="image" loading="lazy" hidden /><slot name="placeholder"></slot></div>`;
      this._img = this._$("[part=image]");
      this._placeholder = this._$("slot[name=placeholder]");
    }
    _setupEvents() {
      this._listen(this._img, "load", () => {
        this._img.hidden = false;
        if (this._placeholder) this._placeholder.hidden = true;
        this.setAttribute("loaded", "");
        this._emit("fb-cover-load", {});
      });
      this._listen(this._img, "error", () => {
        this._img.hidden = true;
        if (this._placeholder) this._placeholder.hidden = false;
        this.removeAttribute("loaded");
        this.removeAttribute("src");
        this._emit("fb-cover-error", {});
      });
    }
    _subscribe() {
      this._sub("playback:trackChanged", () => {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
          void this._loadCover();
        }, 300);
      });
      void this._loadCover();
    }
    disconnectedCallback() {
      if (this._debounceTimer) clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
      super.disconnectedCallback();
    }
    async _loadCover() {
      const type = this.getAttribute("type") || "front";
      const useFb2k = this.hasAttribute("use-fb2k");
      const fb = getFb();
      try {
        let src = "";
        if (useFb2k && fb.artwork.getFb2kUrl) {
          const result = await fb.artwork.getFb2kUrl(type);
          if (result && result.available !== false) {
            const url = result.dataUrl || result.url || "";
            if (url.startsWith("data:")) src = url;
          }
        }
        if (!src) {
          const art = await fb.artwork.getCurrent(type);
          if (art && art.available !== false && art.dataUrl) {
            src = art.dataUrl;
          } else if (art && art.data) {
            src = `data:${art.mimeType || "image/jpeg"};base64,${art.data}`;
          }
        }
        if (src) {
          this._img.src = src;
          if (!src.startsWith("data:")) this.setAttribute("src", src);
          else this.removeAttribute("src");
        } else {
          this._img.hidden = true;
          this._img.removeAttribute("src");
          if (this._placeholder) this._placeholder.hidden = false;
          this.removeAttribute("loaded");
          this.removeAttribute("src");
        }
      } catch {
        this._img.hidden = true;
        if (this._placeholder) this._placeholder.hidden = false;
        this.removeAttribute("loaded");
        this.removeAttribute("src");
      }
    }
  };

  // src/components/FbDspPresetSelector.ts
  var FbDspPresetSelector = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._presets = [];
      this._activeIndex = -1;
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}select{all:unset}</style><select part="select" aria-label="DSP preset"></select>`;
      this._select = this._$("select");
    }
    _setupEvents() {
      this._listen(this._select, "change", () => {
        const index = parseInt(this._select.value, 10);
        const preset = this._presets.find((p) => p.index === index);
        getFb().config.setActiveDspPreset(index).catch(() => {
        });
        this.setAttribute("preset-name", preset?.name || "");
        this._emit("fb-dsp-change", {
          index,
          name: preset?.name || ""
        });
      });
    }
    _subscribe() {
      this._sub("audio:dspPresetChanged", () => {
        void this._loadPresets();
      });
      void this._loadPresets();
    }
    async _loadPresets() {
      try {
        const fb = getFb();
        const [presets, active] = await Promise.all([
          fb.config.getDspPresets(),
          fb.config.getActiveDspPreset()
        ]);
        this._presets = presets ?? [];
        const activeData = active;
        this._activeIndex = activeData?.index ?? -1;
        this._select.innerHTML = this._presets.map(
          (p) => `<option value="${p.index}"${p.index === this._activeIndex ? " selected" : ""}>${this._escHtml(p.name)}</option>`
        ).join("");
        if (activeData?.name) {
          this.setAttribute("preset-name", activeData.name);
        }
      } catch {
      }
    }
  };

  // src/components/constants.ts
  var ORDER_NAMES = [
    "default",
    "repeat-playlist",
    "repeat-track",
    "random",
    "shuffle-tracks",
    "shuffle-albums",
    "shuffle-folders"
  ];
  var RG_MODE_NAMES = ["none", "track", "album", "auto"];
  var SHUFFLE_ORDERS = /* @__PURE__ */ new Set([3, 4, 5, 6]);
  function formatTime(seconds) {
    if (!seconds || !isFinite(seconds) || seconds < 0) return "0:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = Math.floor(seconds % 60);
    const ss = s.toString().padStart(2, "0");
    return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  }

  // src/components/FbLibraryFilesystemTree.ts
  var FbLibraryFilesystemTree = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._rootId = null;
      this._includeFiles = false;
      this._roots = [];
      this._expanded = /* @__PURE__ */ new Set();
      this._loading = /* @__PURE__ */ new Set();
      this._nodeCache = /* @__PURE__ */ new Map();
      this._lastSelected = null;
      /**
       * Monotonic counter bumped on any generation-changing event:
       * `root-id` / `include-files` change, or disconnect. Every async
       * `_loadRoots` / `_loadChildren` captures the current value and
       * bails if a newer generation started, preventing stale trees from
       * overwriting the active view or mutating a detached DOM.
       */
      this._generation = 0;
    }
    static get observedAttributes() {
      return ["root-id", "include-files"];
    }
    attributeChangedCallback(name) {
      if (!this._domReady) return;
      if (name === "root-id") {
        this._rootId = this.getAttribute("root-id") || null;
        this._expanded.clear();
        this._nodeCache.clear();
        this._generation++;
        void this._loadRoots();
      }
      if (name === "include-files") {
        this._includeFiles = this.getAttribute("include-files") === "true";
        this._nodeCache.clear();
        this._generation++;
        this._rebuildTree();
      }
    }
    disconnectedCallback() {
      this._generation++;
      super.disconnectedCallback();
    }
    _buildDOM() {
      this._rootId = this.getAttribute("root-id") || null;
      this._includeFiles = this.getAttribute("include-files") === "true";
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:block;overflow-y:auto}[part=container]{display:flex;flex-direction:column}[part~=node]{display:flex;align-items:center;cursor:pointer;gap:4px}[part~=child]{display:flex;align-items:center;cursor:pointer;gap:4px}[part~=file]{display:flex;align-items:center;cursor:pointer;gap:4px}</style><div part="container" role="tree"></div>`;
      this._container = this._$("[part=container]");
    }
    _setupEvents() {
      this._listen(this._container, "click", (e) => {
        const me = e;
        const target = me.target;
        const node = target?.closest(
          "[data-node-type]"
        );
        if (!node) return;
        const nodeType = node.dataset.nodeType || "";
        if (nodeType === "header") return;
        if (target?.closest("[part=node-toggle]") && (nodeType === "root" || nodeType === "directory")) {
          void this._toggleExpand(node);
          return;
        }
        this._selectNode(node, me.ctrlKey || me.metaKey, me.shiftKey);
        this._emitSelect(node);
      });
      this._listen(this._container, "dblclick", (e) => {
        const target = e.target;
        const node = target?.closest(
          "[data-node-type]"
        );
        if (!node) return;
        const nodeType = node.dataset.nodeType || "";
        if (nodeType === "header") return;
        this._emitPlay(node);
      });
      this._listen(this._container, "contextmenu", (e) => {
        const me = e;
        const target = me.target;
        const node = target?.closest(
          "[data-node-type]"
        );
        if (!node) return;
        const nodeType = node.dataset.nodeType || "";
        if (nodeType === "header") return;
        me.preventDefault();
        if (!node.hasAttribute("selected")) {
          this._selectNode(node, false, false);
          this._emitSelect(node);
        }
        const detail = {
          type: nodeType,
          rootId: node.dataset.rootId || "",
          pathId: node.dataset.pathId || "",
          absolutePath: node.dataset.absolutePath || "",
          x: me.clientX,
          y: me.clientY
        };
        if (nodeType === "file" && node.dataset.fileInfo) {
          try {
            detail.file = JSON.parse(node.dataset.fileInfo);
          } catch {
          }
        }
        this._emit(
          "fb-library-fs-context",
          detail
        );
      });
    }
    _subscribe() {
      const invalidate = () => {
        this._nodeCache.clear();
        void this._loadRoots();
      };
      this._sub("library:itemsAdded", invalidate);
      this._sub("library:itemsRemoved", invalidate);
      this._sub("library:itemsModified", invalidate);
      this._sub("library:initialized", invalidate);
      void this._loadRoots();
    }
    async _loadRoots() {
      const fb = getFb();
      const gen = this._generation;
      try {
        if (this._rootId) {
          this._roots = [];
          this._rebuildTree();
          if (gen !== this._generation || !this.isConnected) return;
          await this._loadChildren(this._rootId, "");
          return;
        }
        const result = await fb.library.getRoots();
        if (gen !== this._generation || !this.isConnected) return;
        if (!result || !result.success) {
          this._roots = [];
        } else {
          this._roots = result.roots || [];
        }
        this._rebuildTree();
      } catch {
        if (gen !== this._generation || !this.isConnected) return;
        this._roots = [];
        this._rebuildTree();
      }
    }
    _rebuildTree() {
      const frag = document.createDocumentFragment();
      if (this._rootId) {
        const cacheKey = this._rootId + "::";
        const cached = this._nodeCache.get(cacheKey);
        if (cached) {
          this._appendDirectories(
            frag,
            cached.directories,
            this._rootId,
            0
          );
          if (this._includeFiles && cached.files) {
            this._appendFiles(frag, cached.files, this._rootId, "");
          }
        }
      } else {
        const header = document.createElement("div");
        header.setAttribute("part", "header");
        header.dataset.nodeType = "header";
        header.setAttribute("role", "treeitem");
        const totalCount = this._roots.reduce(
          (s, r) => s + (r.trackCount || 0),
          0
        );
        header.innerHTML = `<span part="node-label">All Music</span><span part="node-count">(${totalCount})</span>`;
        frag.appendChild(header);
        for (const root of this._roots) {
          const expanded = this._expanded.has("root::" + root.id);
          const node = document.createElement("div");
          node.setAttribute("part", "node root");
          node.dataset.nodeType = "root";
          node.dataset.rootId = root.id;
          node.dataset.pathId = "";
          node.dataset.absolutePath = root.absolutePath;
          node.setAttribute("role", "treeitem");
          if (expanded) node.setAttribute("expanded", "");
          node.innerHTML = `<span part="node-toggle">${expanded ? "\u25BE" : "\u25B8"}</span><span part="node-label">${this._escHtml(root.displayName)}</span><span part="node-count">(${root.trackCount || 0})</span>`;
          frag.appendChild(node);
          const children = document.createElement("div");
          children.setAttribute("part", "node-children");
          children.style.display = expanded ? "" : "none";
          if (expanded) {
            const cacheKey = root.id + "::";
            const cached = this._nodeCache.get(cacheKey);
            if (cached) {
              this._appendDirectories(
                children,
                cached.directories,
                root.id,
                1
              );
              if (this._includeFiles && cached.files) {
                this._appendFiles(
                  children,
                  cached.files,
                  root.id,
                  ""
                );
              }
            }
          }
          frag.appendChild(children);
        }
      }
      this._container.innerHTML = "";
      this._container.appendChild(frag);
    }
    _appendDirectories(parent, directories, rootId, depth) {
      for (const dir of directories) {
        const expandKey = rootId + "::" + dir.pathId;
        const expanded = this._expanded.has(expandKey);
        const node = document.createElement("div");
        node.setAttribute("part", "node directory");
        node.dataset.nodeType = "directory";
        node.dataset.rootId = rootId;
        node.dataset.pathId = dir.pathId;
        node.dataset.absolutePath = dir.absolutePath || "";
        node.setAttribute("role", "treeitem");
        node.style.paddingLeft = depth * 16 + "px";
        if (expanded) node.setAttribute("expanded", "");
        node.innerHTML = `<span part="node-toggle">${dir.hasChildren ? expanded ? "\u25BE" : "\u25B8" : "\xA0"}</span><span part="node-label">${this._escHtml(dir.displayName || dir.name || "")}</span><span part="node-count">(${dir.trackCount || 0})</span>`;
        parent.appendChild(node);
        if (dir.hasChildren || this._includeFiles && (dir.trackCount || 0) > 0) {
          const children = document.createElement("div");
          children.setAttribute("part", "node-children");
          children.style.display = expanded ? "" : "none";
          if (expanded) {
            const cacheKey = rootId + "::" + dir.pathId;
            const cached = this._nodeCache.get(cacheKey);
            if (cached) {
              this._appendDirectories(
                children,
                cached.directories,
                rootId,
                depth + 1
              );
              if (this._includeFiles && cached.files) {
                this._appendFiles(
                  children,
                  cached.files,
                  rootId,
                  dir.pathId
                );
              }
            }
          }
          parent.appendChild(children);
        }
      }
    }
    _appendFiles(parent, files, rootId, pathId) {
      for (const file of files) {
        const node = document.createElement("div");
        node.setAttribute("part", "node file");
        node.dataset.nodeType = "file";
        node.dataset.rootId = rootId;
        node.dataset.pathId = pathId;
        node.dataset.absolutePath = file.absolutePath || file.path || "";
        node.dataset.subsong = String(file.subsong ?? 0);
        try {
          node.dataset.fileInfo = JSON.stringify(file);
        } catch {
        }
        node.setAttribute("role", "treeitem");
        node.innerHTML = `<span part="node-label">${this._escHtml(file.title || file.filename || "(Unknown)")}</span><span part="node-count">${formatTime(file.duration || 0)}</span>`;
        parent.appendChild(node);
      }
    }
    async _toggleExpand(nodeEl) {
      const nodeType = nodeEl.dataset.nodeType || "";
      const rootId = nodeEl.dataset.rootId || "";
      const pathId = nodeEl.dataset.pathId || "";
      const key = nodeType === "root" ? "root::" + rootId : rootId + "::" + pathId;
      if (this._expanded.has(key)) {
        this._expanded.delete(key);
        nodeEl.removeAttribute("expanded");
        const toggle = nodeEl.querySelector("[part=node-toggle]");
        if (toggle) toggle.textContent = "\u25B8";
        const children = nodeEl.nextElementSibling;
        if (children?.getAttribute("part") === "node-children") {
          children.style.display = "none";
        }
      } else {
        this._expanded.add(key);
        nodeEl.setAttribute("expanded", "");
        const toggle = nodeEl.querySelector("[part=node-toggle]");
        if (toggle) toggle.textContent = "\u25BE";
        const children = nodeEl.nextElementSibling;
        if (children?.getAttribute("part") === "node-children") {
          children.style.display = "";
          if (!children.hasChildNodes()) {
            await this._loadChildren(rootId, pathId, children);
          }
        }
      }
    }
    async _loadChildren(rootId, pathId, container) {
      const cacheKey = rootId + "::" + pathId;
      if (this._loading.has(cacheKey)) return;
      this._loading.add(cacheKey);
      const fb = getFb();
      const gen = this._generation;
      try {
        const result = await fb.library.browseTree({
          rootId,
          pathId: pathId || void 0,
          includeFiles: this._includeFiles,
          recursiveFiles: false
        });
        if (gen !== this._generation || !this.isConnected) return;
        if (!result || !result.success) {
          return;
        }
        this._nodeCache.set(cacheKey, {
          directories: result.directories || [],
          files: result.files || []
        });
        if (container && container.isConnected) {
          const frag = document.createDocumentFragment();
          const depth = pathId ? pathId.split("/").length + 1 : 1;
          this._appendDirectories(
            frag,
            result.directories || [],
            rootId,
            depth
          );
          if (this._includeFiles && result.files) {
            this._appendFiles(frag, result.files, rootId, pathId);
          }
          container.appendChild(frag);
        } else if (!container) {
          this._rebuildTree();
        }
      } catch {
      } finally {
        this._loading.delete(cacheKey);
      }
    }
    _emitSelect(nodeEl) {
      const detail = {
        type: nodeEl.dataset.nodeType || "",
        rootId: nodeEl.dataset.rootId || "",
        pathId: nodeEl.dataset.pathId || "",
        absolutePath: nodeEl.dataset.absolutePath || ""
      };
      if (nodeEl.dataset.nodeType === "file" && nodeEl.dataset.fileInfo) {
        try {
          detail.file = JSON.parse(nodeEl.dataset.fileInfo);
        } catch {
        }
      }
      this._emit("fb-library-fs-select", detail);
    }
    _emitPlay(nodeEl) {
      const detail = {
        type: nodeEl.dataset.nodeType || "",
        rootId: nodeEl.dataset.rootId || "",
        pathId: nodeEl.dataset.pathId || "",
        absolutePath: nodeEl.dataset.absolutePath || ""
      };
      if (nodeEl.dataset.nodeType === "file" && nodeEl.dataset.fileInfo) {
        try {
          detail.file = JSON.parse(nodeEl.dataset.fileInfo);
        } catch {
        }
      }
      this._emit("fb-library-fs-play", detail);
    }
    _selectNode(node, ctrlKey = false, shiftKey = false) {
      const sel = (n) => {
        n.setAttribute("selected", "");
        const part = n.getAttribute("part") || "";
        if (!part.includes(" selected")) {
          n.setAttribute("part", `${part} selected`);
        }
      };
      const desel = (n) => {
        n.removeAttribute("selected");
        const part = n.getAttribute("part") || "";
        n.setAttribute("part", part.replace(" selected", ""));
      };
      if (ctrlKey) {
        if (node.hasAttribute("selected")) desel(node);
        else sel(node);
      } else if (shiftKey && this._lastSelected) {
        const allNodes = Array.from(
          this._container.querySelectorAll(
            "[data-node-type=root],[data-node-type=directory],[data-node-type=file]"
          )
        );
        const from = allNodes.indexOf(this._lastSelected);
        const to = allNodes.indexOf(node);
        if (from >= 0 && to >= 0) {
          this._container.querySelectorAll("[selected]").forEach((n) => desel(n));
          const [start, end] = from < to ? [from, to] : [to, from];
          for (let i = start; i <= end; i++) sel(allNodes[i]);
        }
      } else {
        this._container.querySelectorAll("[selected]").forEach((n) => desel(n));
        sel(node);
      }
      this._lastSelected = node;
    }
  };

  // src/components/FbLibraryTree.ts
  var HEADER_LABELS = {
    artist: "All Artists",
    album: "All Albums",
    genre: "All Genres"
  };
  var FbLibraryTree = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._view = "artist";
      this._sort = "name";
      this._filter = "";
      this._items = [];
      this._expanded = /* @__PURE__ */ new Set();
      this._loading = false;
      this._lastSelected = null;
      /**
       * Monotonic counter bumped whenever the component enters a new
       * display generation — view / sort / filter change, or disconnect.
       * Every async `_loadItems` / `_loadChildren` call captures the current
       * value and bails if a newer generation started while the host call
       * was in flight, preventing stale results from clobbering the active
       * view or mutating a detached DOM.
       */
      this._generation = 0;
    }
    static get observedAttributes() {
      return ["view", "sort", "filter"];
    }
    attributeChangedCallback(name) {
      if (!this._domReady) return;
      if (name === "view") {
        this._view = this.getAttribute("view") || "artist";
        this._expanded.clear();
        this._generation++;
        void this._loadItems();
      }
      if (name === "sort") {
        this._sort = this.getAttribute("sort") || "name";
        this._generation++;
        void this._loadItems();
      }
      if (name === "filter") {
        this._filter = this.getAttribute("filter") || "";
        this._generation++;
        void this._loadItems();
      }
    }
    disconnectedCallback() {
      this._generation++;
      super.disconnectedCallback();
    }
    _buildDOM() {
      this._view = this.getAttribute("view") || "artist";
      this._sort = this.getAttribute("sort") || "name";
      this._filter = this.getAttribute("filter") || "";
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:block;overflow-y:auto}[part=container]{display:flex;flex-direction:column}[part~=node]{display:flex;align-items:center;cursor:pointer;gap:4px}[part~=child]{display:flex;align-items:center;cursor:pointer;gap:4px}</style><div part="container" role="tree"></div>`;
      this._container = this._$("[part=container]");
    }
    _setupEvents() {
      this._listen(this._container, "click", (e) => {
        const me = e;
        const target = me.target;
        const node = target?.closest(
          "[part~=node],[part~=child]"
        );
        if (!node) return;
        const key = node.dataset.key || "";
        const type = node.dataset.type || "";
        if (type === "header") return;
        if (type === "group") {
          if (target?.closest("[part=node-toggle]")) {
            void this._toggleNode(key, node);
            return;
          }
          this._selectNode(node, me.ctrlKey || me.metaKey, me.shiftKey);
          this._emit("fb-library-select", {
            key,
            type,
            view: this._view,
            selected: this._getSelectedInfo()
          });
        } else if (type === "album" || type === "track") {
          this._selectNode(node, me.ctrlKey || me.metaKey, me.shiftKey);
          this._emit("fb-library-select", {
            key,
            type,
            view: this._view,
            artist: node.dataset.artist,
            selected: this._getSelectedInfo()
          });
        }
      });
      this._listen(this._container, "dblclick", (e) => {
        const target = e.target;
        const node = target?.closest(
          "[part~=node],[part~=child]"
        );
        if (!node) return;
        const key = node.dataset.key || "";
        const type = node.dataset.type || "";
        this._emit("fb-library-play", {
          key,
          type,
          view: this._view
        });
      });
      this._listen(this._container, "contextmenu", (e) => {
        const me = e;
        const target = me.target;
        const node = target?.closest(
          "[part~=node],[part~=child]"
        );
        if (!node) return;
        me.preventDefault();
        const type = node.dataset.type || "";
        if (type === "header") return;
        if (!node.hasAttribute("selected")) {
          this._selectNode(node, false, false);
          this._emit("fb-library-select", {
            key: node.dataset.key || "",
            type,
            view: this._view,
            artist: node.dataset.artist,
            selected: this._getSelectedInfo()
          });
        }
        this._emit("fb-library-context", {
          key: node.dataset.key || "",
          type,
          view: this._view,
          x: me.clientX,
          y: me.clientY,
          selected: this._getSelectedInfo()
        });
      });
    }
    _subscribe() {
      const reload = () => {
        this._items = [];
        void this._loadItems();
      };
      this._sub("library:itemsAdded", reload);
      this._sub("library:itemsRemoved", reload);
      this._sub("library:itemsModified", reload);
      this._sub("library:initialized", reload);
      void this._loadItems();
    }
    async _toggleNode(key, node) {
      if (this._expanded.has(key)) {
        this._expanded.delete(key);
        node.removeAttribute("expanded");
        const toggle = node.querySelector("[part=node-toggle]");
        if (toggle) toggle.textContent = "\u25B8";
        const children = node.nextElementSibling;
        if (children?.getAttribute("part") === "node-children") {
          children.style.display = "none";
        }
      } else {
        this._expanded.add(key);
        node.setAttribute("expanded", "");
        const toggle = node.querySelector("[part=node-toggle]");
        if (toggle) toggle.textContent = "\u25BE";
        const children = node.nextElementSibling;
        if (children?.getAttribute("part") === "node-children") {
          children.style.display = "";
          if (!children.hasChildNodes()) {
            await this._loadChildren(key, children);
          }
        }
      }
    }
    async _loadItems() {
      if (this._loading) return;
      this._loading = true;
      const fb = getFb();
      const gen = this._generation;
      try {
        let items = [];
        switch (this._view) {
          case "album": {
            const result = await fb.library.getAlbums(5e3);
            items = result?.albums || [];
            break;
          }
          case "genre": {
            const result = await fb.library.getGenres();
            items = result?.items || result?.genres || [];
            break;
          }
          case "artist":
          default: {
            const result = await fb.library.getArtists(5e3);
            items = result?.items || [];
            break;
          }
        }
        if (gen !== this._generation || !this.isConnected) return;
        this._items = items;
        this._rebuildTree();
      } catch {
        if (gen !== this._generation || !this.isConnected) return;
        this._items = [];
        this._rebuildTree();
      } finally {
        this._loading = false;
      }
    }
    _rebuildTree() {
      const view = this._view;
      const totalCount = this._items.length;
      const frag = document.createDocumentFragment();
      const header = document.createElement("div");
      header.setAttribute("part", "header");
      header.dataset.type = "header";
      header.setAttribute("role", "treeitem");
      header.innerHTML = `<span part="node-label">${HEADER_LABELS[view] || HEADER_LABELS.artist}</span><span part="node-count">(${totalCount})</span>`;
      frag.appendChild(header);
      for (const item of this._items) {
        const name = item.name || "(Unknown)";
        const key = name;
        const count = item.trackCount || 0;
        const expanded = this._expanded.has(key);
        const node = document.createElement("div");
        node.setAttribute("part", "node");
        node.dataset.key = key;
        node.dataset.type = "group";
        node.setAttribute("role", "treeitem");
        if (expanded) node.setAttribute("expanded", "");
        node.innerHTML = `<span part="node-toggle">${expanded ? "\u25BE" : "\u25B8"}</span><span part="node-label">${this._escHtml(name)}</span><span part="node-count">(${count})</span>`;
        frag.appendChild(node);
        const childrenDiv = document.createElement("div");
        childrenDiv.setAttribute("part", "node-children");
        childrenDiv.setAttribute("role", "group");
        if (!expanded) childrenDiv.style.display = "none";
        frag.appendChild(childrenDiv);
      }
      this._container.textContent = "";
      this._container.appendChild(frag);
      this.setAttribute("item-count", totalCount.toString());
      this.setAttribute("view", view);
      for (const key of this._expanded) {
        const node = this._container.querySelector(
          `[data-key="${CSS.escape(key)}"][expanded]`
        );
        if (node) {
          const children = node.nextElementSibling;
          if (children?.getAttribute("part") === "node-children" && !children.hasChildNodes()) {
            void this._loadChildren(key, children);
          }
        }
      }
    }
    async _loadChildren(key, container) {
      const fb = getFb();
      const gen = this._generation;
      try {
        let html = "";
        const view = this._view;
        if (view === "artist") {
          const result = await fb.library.getArtistAlbums(key);
          const albums = result?.albums || [];
          html = albums.map(
            (a) => `<div part="child" data-key="${this._escAttr(a.name || "")}" data-type="album" data-artist="${this._escAttr(key)}" role="treeitem"><span part="node-label">${this._escHtml(a.name || "(Unknown Album)")}</span><span part="node-count">(${a.trackCount || 0})</span></div>`
          ).join("");
        } else if (view === "album") {
          const result = await fb.library.getAlbumTracks(key);
          const tracks = result?.items || result?.tracks || [];
          html = tracks.map(
            (t) => `<div part="child" data-key="${this._escAttr(t.path || t.absolutePath || "")}" data-type="track" role="treeitem"><span part="node-label">${this._escHtml(t.title || "(Unknown)")}</span><span part="node-count">${formatTime(t.duration || 0)}</span></div>`
          ).join("");
        } else if (view === "genre") {
          const result = await fb.library.search(
            'genre IS "' + key.replace(/"/g, '\\"') + '"',
            500
          );
          const tracks = result?.items || result?.tracks || [];
          html = tracks.map(
            (t) => `<div part="child" data-key="${this._escAttr(t.path || t.absolutePath || "")}" data-type="track" role="treeitem"><span part="node-label">${this._escHtml(t.title || "(Unknown)")}</span><span part="node-count">${formatTime(t.duration || 0)}</span></div>`
          ).join("");
        }
        if (gen !== this._generation || !this.isConnected || !container.isConnected)
          return;
        container.innerHTML = html || '<div part="child" data-type="empty" role="treeitem"><span part="node-label">(empty)</span></div>';
      } catch {
        if (gen !== this._generation || !this.isConnected || !container.isConnected)
          return;
        container.innerHTML = '<div part="child" data-type="empty" role="treeitem"><span part="node-label">(failed to load)</span></div>';
      }
    }
    /**
     * Programmatically add a row's tracks to the active playlist.
     * Themes typically wire this into the right-click context menu;
     * exposed publicly so callers don't have to re-implement the same
     * fan-out logic.
     */
    async addToPlaylist(key, type, artist) {
      const fb = getFb();
      try {
        let paths = [];
        if (type === "track") {
          paths = [key];
        } else if (type === "album") {
          const result = await fb.library.getAlbumTracks(
            key,
            artist || ""
          );
          paths = (result?.items || result?.tracks || []).map((t) => t.path || t.absolutePath || "").filter(Boolean);
        } else if (type === "group") {
          if (this._view === "artist") {
            const result = await fb.library.getArtistTracks(
              key
            );
            paths = (result?.items || result?.tracks || []).map((t) => t.path || t.absolutePath || "").filter(Boolean);
          } else if (this._view === "genre") {
            const result = await fb.library.search(
              'genre IS "' + key.replace(/"/g, '\\"') + '"',
              5e3
            );
            paths = (result?.items || result?.tracks || []).map((t) => t.path || t.absolutePath || "").filter(Boolean);
          } else if (this._view === "album") {
            const result = await fb.library.getAlbumTracks(
              key
            );
            paths = (result?.items || result?.tracks || []).map((t) => t.path || t.absolutePath || "").filter(Boolean);
          }
        }
        if (paths.length > 0) {
          await fb.library.addToPlaylist(paths);
          this._emit("fb-library-added", {
            count: paths.length,
            type,
            key
          });
        }
      } catch {
      }
    }
    _selectNode(node, ctrlKey = false, shiftKey = false) {
      const sel = (n) => {
        n.setAttribute("selected", "");
        const part = n.getAttribute("part") || "";
        n.setAttribute("part", `${part} selected`);
      };
      const desel = (n) => {
        n.removeAttribute("selected");
        const part = n.getAttribute("part") || "";
        n.setAttribute("part", part.replace(" selected", ""));
      };
      if (ctrlKey) {
        if (node.hasAttribute("selected")) desel(node);
        else sel(node);
      } else if (shiftKey && this._lastSelected) {
        const allNodes = Array.from(
          this._container.querySelectorAll(
            "[data-type=group],[data-type=album],[data-type=track]"
          )
        );
        const from = allNodes.indexOf(this._lastSelected);
        const to = allNodes.indexOf(node);
        if (from >= 0 && to >= 0) {
          this._container.querySelectorAll("[selected]").forEach((n) => desel(n));
          const [start, end] = from < to ? [from, to] : [to, from];
          for (let i = start; i <= end; i++) sel(allNodes[i]);
        }
      } else {
        this._container.querySelectorAll("[selected]").forEach((n) => desel(n));
        sel(node);
      }
      this._lastSelected = node;
    }
    _getSelectedInfo() {
      return Array.from(
        this._container.querySelectorAll("[selected]")
      ).map((n) => ({
        key: n.dataset.key || "",
        type: n.dataset.type || "",
        artist: n.dataset.artist
      }));
    }
    /**
     * Attribute-safe escape (separate from {@link _escHtml}). HTML
     * escape doesn't always fully sanitise an attribute context, so
     * `&` / `"` / `<` / `>` are escaped together for safe `data-*`
     * payload interpolation.
     */
    _escAttr(s) {
      return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  };

  // src/components/FbLyricsPanel.ts
  function parseLRC(lrc) {
    const lines = [];
    const regex = /\[(\d{2,}):(\d{2})(?:\.(\d{2,3}))?\](.*)$/gm;
    let match;
    while ((match = regex.exec(lrc)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, "0"), 10) : 0;
      const time = minutes * 60 + seconds + ms / 1e3;
      const text = match[4].trim();
      lines.push({ time, text });
    }
    return lines.sort((a, b) => a.time - b.time);
  }
  var FbLyricsPanel = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._lines = [];
      this._rows = [];
      this._currentIndex = -1;
      this._trackPath = null;
      this._debounceTimer = null;
      this._loadToken = 0;
      this._lastScrollAt = 0;
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:block;overflow-y:auto}div[part=container]{display:flex;flex-direction:column}</style><div part="container"></div>`;
      this._container = this._$("[part=container]");
    }
    _setupEvents() {
      this._listen(this._container, "click", (e) => {
        const target = e.target;
        const row = target?.closest("[part=line]");
        if (!row) return;
        const time = parseFloat(row.dataset.time || "");
        if (isFinite(time)) {
          getFb().player.seek(time).catch(() => {
          });
          this._emit("fb-lyrics-seek", { time });
        }
      });
    }
    _subscribe() {
      this._sub("playback:trackChanged", () => {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
          void this._loadLyrics();
        }, 350);
      });
      this._sub("playback:time", (data) => {
        const position = data?.position ?? 0;
        this._updateCurrent(position);
      });
      void this._loadLyrics();
    }
    disconnectedCallback() {
      if (this._debounceTimer) clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
      this._loadToken += 1;
      super.disconnectedCallback();
    }
    async _loadLyrics() {
      const loadToken = ++this._loadToken;
      const fb = getFb();
      try {
        const track = await fb.player.getCurrentTrack();
        if (loadToken !== this._loadToken) return;
        const path = track?.path || "";
        if (!path || path === this._trackPath) return;
        this._trackPath = path;
        const source = this.getAttribute("source") || "any";
        const result = await fb.lyrics.get(
          path,
          source
        );
        if (loadToken !== this._loadToken) return;
        if (result?.available && result.lyrics) {
          const rawLines = result.synced ? parseLRC(result.lyrics) : result.lyrics.split("\n").map((text, i) => ({ time: i, text }));
          this._lines = rawLines;
          this._renderLines();
          this._currentIndex = -1;
          this._lastScrollAt = 0;
          this.setAttribute("has-lyrics", "");
          this._emit("fb-lyrics-loaded", {
            lineCount: this._lines.length,
            synced: !!result.synced
          });
        } else {
          this._lines = [];
          this._rows = [];
          this._currentIndex = -1;
          this._container.innerHTML = '<div part="line" class="empty">No lyrics</div>';
          this.removeAttribute("has-lyrics");
        }
      } catch {
        if (loadToken !== this._loadToken) return;
        this._lines = [];
        this._rows = [];
        this._currentIndex = -1;
        this._container.innerHTML = "";
        this.removeAttribute("has-lyrics");
      }
    }
    _renderLines() {
      this._container.innerHTML = this._lines.map(
        (line, i) => `<div part="line" data-index="${i}" data-time="${line.time}" class="future">${this._escHtml(line.text)}</div>`
      ).join("");
      this._rows = Array.from(this._$$("[part=line]"));
    }
    _setRowState(index, state) {
      const row = this._rows[index];
      if (!row) return;
      row.classList.remove("past", "current", "future");
      row.classList.add(state);
    }
    _setRangeState(start, end, state) {
      if (end < start) return;
      const safeStart = Math.max(0, start);
      const safeEnd = Math.min(this._rows.length - 1, end);
      for (let i = safeStart; i <= safeEnd; i++) {
        this._setRowState(i, state);
      }
    }
    _isRowComfortablyVisible(row) {
      if (!row) return false;
      const viewportTop = this.scrollTop;
      const viewportBottom = viewportTop + this.clientHeight;
      const padding = Math.max(24, Math.floor(this.clientHeight * 0.2));
      const rowTop = row.offsetTop;
      const rowBottom = rowTop + row.offsetHeight;
      return rowTop >= viewportTop + padding && rowBottom <= viewportBottom - padding;
    }
    _scrollCurrentRow(row) {
      if (!row) return;
      const now = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      const hasFocus = typeof document !== "undefined" && typeof document.hasFocus === "function" ? document.hasFocus() : true;
      const requestedMode = this.getAttribute("scroll") || "smooth";
      const behavior = requestedMode === "smooth" && hasFocus ? "smooth" : "auto";
      const needScroll = !this._isRowComfortablyVisible(row);
      const cooldownMs = hasFocus ? 350 : 900;
      if (!needScroll && now - this._lastScrollAt < cooldownMs) return;
      row.scrollIntoView({ behavior, block: "center" });
      this._lastScrollAt = now;
    }
    _updateCurrent(position) {
      if (this._lines.length === 0 || this._rows.length === 0) return;
      let newIndex = -1;
      for (let i = this._lines.length - 1; i >= 0; i--) {
        if (this._lines[i].time <= position) {
          newIndex = i;
          break;
        }
      }
      const previousIndex = this._currentIndex;
      if (newIndex === previousIndex) return;
      this._currentIndex = newIndex;
      if (newIndex === -1) {
        this._setRangeState(0, previousIndex, "future");
      } else if (previousIndex === -1 || newIndex > previousIndex) {
        this._setRangeState(
          previousIndex >= 0 ? previousIndex : 0,
          newIndex - 1,
          "past"
        );
      } else if (newIndex < previousIndex) {
        this._setRangeState(newIndex + 1, previousIndex, "future");
      }
      if (newIndex >= 0) {
        this._setRowState(newIndex, "current");
      }
      if (newIndex >= 0) {
        this._scrollCurrentRow(this._rows[newIndex]);
      }
      this.setAttribute("current-line", newIndex.toString());
      if (newIndex >= 0) {
        this._emit("fb-lyrics-line-change", {
          index: newIndex,
          text: this._lines[newIndex].text,
          time: this._lines[newIndex].time
        });
      }
    }
  };

  // src/components/FbNextButton.ts
  var FbNextButton = class extends FbBaseElement {
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}</style><button part="button" role="button" tabindex="0" aria-label="Next"><slot>\u23ED</slot></button>`;
      this._btn = this._$("button");
    }
    _setupEvents() {
      this._listen(this._btn, "click", () => {
        void this._handleClick();
      });
      this._listen(this._btn, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void this._handleClick();
        }
      });
    }
    async _handleClick() {
      try {
        await getFb().player.next();
        this._emit("fb-next", {});
      } catch {
      }
    }
  };

  // src/components/FbOutputSelector.ts
  var FbOutputSelector = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._devices = [];
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}select{all:unset}</style><select part="select" aria-label="Output device"></select>`;
      this._select = this._$("select");
    }
    _setupEvents() {
      this._listen(this._select, "change", () => {
        const idx = parseInt(this._select.value, 10);
        const device = this._devices[idx];
        if (!device) return;
        getFb().config.setOutputDevice(device.outputId, device.deviceId).catch(() => {
        });
        this.setAttribute("device-name", device.name);
        this._emit("fb-output-change", {
          index: idx,
          name: device.name,
          outputId: device.outputId,
          deviceId: device.deviceId
        });
      });
    }
    _subscribe() {
      this._sub("audio:outputDeviceChanged", () => {
        void this._loadDevices();
      });
      void this._loadDevices();
    }
    async _loadDevices() {
      try {
        const devices = await getFb().config.getOutputDevices();
        this._devices = devices ?? [];
        this._select.innerHTML = this._devices.map(
          (d, i) => `<option value="${i}"${d.isCurrent ? " selected" : ""}>${this._escHtml(d.name)}</option>`
        ).join("");
        const current = this._devices.find((d) => d.isCurrent);
        if (current) {
          this.setAttribute("device-name", current.name);
        }
      } catch {
      }
    }
  };

  // src/components/FbPlaybackOrder.ts
  var FbPlaybackOrder = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._select = null;
      this._btn = null;
      this._slot = null;
    }
    static get observedAttributes() {
      return ["mode"];
    }
    attributeChangedCallback() {
      if (!this._domReady) return;
      this._abortController.abort();
      this._abortController = new AbortController();
      this._buildDOM();
      this._setupEvents();
      getFb().player.getOrder().then((r) => this._update(r.order)).catch(() => {
      });
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      const useSelect = this.getAttribute("mode") === "select";
      if (useSelect) {
        root.innerHTML = `<style>${FbBaseElement.baseCSS}select{all:unset}</style><select part="select" aria-label="Playback order">` + ORDER_NAMES.map(
          (name, i) => `<option value="${i}">${name}</option>`
        ).join("") + `</select>`;
        this._select = this._$("select");
        this._btn = null;
        this._slot = null;
      } else {
        root.innerHTML = `<style>${FbBaseElement.baseCSS}</style><button part="button" role="button" tabindex="0" aria-label="Playback order"><slot>default</slot></button>`;
        this._btn = this._$("button");
        this._slot = this._$("slot");
        this._select = null;
      }
    }
    _setupEvents() {
      if (this._select) {
        this._listen(this._select, "change", () => {
          void this._selectOrder();
        });
      } else if (this._btn) {
        this._listen(this._btn, "click", () => {
          void this._cycleOrder();
        });
        this._listen(this._btn, "keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void this._cycleOrder();
          }
        });
      }
    }
    async _selectOrder() {
      if (!this._select) return;
      try {
        const order = parseInt(this._select.value, 10);
        await getFb().player.setOrder(order);
        this._emit("fb-order-change", {
          order,
          name: ORDER_NAMES[order] ?? "unknown"
        });
      } catch {
      }
    }
    async _cycleOrder() {
      try {
        const fb = getFb();
        const current = await fb.player.getOrder();
        const newOrder = (current.order + 1) % ORDER_NAMES.length;
        await fb.player.setOrder(newOrder);
        this._emit("fb-order-change", {
          order: newOrder,
          name: ORDER_NAMES[newOrder] ?? "unknown"
        });
      } catch {
      }
    }
    _subscribe() {
      this._sub("playback:orderChanged", (data) => {
        this._update(data?.orderIndex ?? 0);
      });
      getFb().player.getOrder().then((r) => this._update(r.order)).catch(() => {
      });
    }
    _update(order) {
      const name = ORDER_NAMES[order] ?? "unknown";
      this.setAttribute("order", name);
      if (this._select) {
        this._select.value = order.toString();
      } else if (this._slot) {
        this._slot.textContent = name;
      }
    }
  };

  // src/components/FbPlayButton.ts
  var FbPlayButton = class extends FbBaseElement {
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}</style><button part="button" role="button" tabindex="0" aria-label="Play"><slot name="play-icon">\u25B6</slot><slot name="pause-icon" hidden>\u23F8</slot></button>`;
      this._btn = this._$("button");
      this._playSlot = this._$("slot[name=play-icon]");
      this._pauseSlot = this._$("slot[name=pause-icon]");
    }
    _setupEvents() {
      this._listen(this._btn, "click", () => {
        void this._handleClick();
      });
      this._listen(this._btn, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void this._handleClick();
        }
      });
    }
    _subscribe() {
      this._sub("playback:stateChanged", (data) => {
        this._update(data?.state === "playing");
      });
      getFb().player.getState().then((s) => {
        this._update(s?.state === "playing");
      }).catch(() => {
      });
    }
    async _handleClick() {
      try {
        await getFb().player.toggle();
      } catch {
      }
    }
    _update(isPlaying) {
      this._playSlot.hidden = isPlaying;
      this._pauseSlot.hidden = !isPlaying;
      this._btn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
      if (isPlaying) {
        this.setAttribute("playing", "");
        this._emit("fb-play", {});
      } else {
        this.removeAttribute("playing");
        this._emit("fb-pause", {});
      }
    }
  };

  // src/components/FbPlaylistSelector.ts
  var FbPlaylistSelector = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._playlists = [];
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}select{all:unset}</style><select part="select" aria-label="Select playlist"></select>`;
      this._select = this._$("select");
    }
    _setupEvents() {
      this._listen(this._select, "change", () => {
        const index = parseInt(this._select.value, 10);
        const name = this._playlists[index]?.name ?? "";
        this.setAttribute("selected-index", index.toString());
        this.setAttribute("selected-name", name);
        this._emit("fb-playlist-pick", {
          index,
          name
        });
      });
    }
    _subscribe() {
      const refresh = () => {
        void this._loadPlaylists();
      };
      this._sub("playlist:created", refresh);
      this._sub("playlist:removed", refresh);
      this._sub("playlist:renamed", refresh);
      void this._loadPlaylists();
    }
    async _loadPlaylists() {
      try {
        const result = await getFb().playlist.getAll();
        this._playlists = result ?? [];
        this._select.innerHTML = this._playlists.map(
          (pl, i) => `<option value="${i}"${pl.isActive ? " selected" : ""}>${this._escHtml(pl.name)} (${pl.trackCount})</option>`
        ).join("");
        const active = this._playlists.findIndex((p) => p.isActive);
        if (active >= 0) {
          this.setAttribute("selected-index", active.toString());
          this.setAttribute(
            "selected-name",
            this._playlists[active].name
          );
        }
      } catch {
      }
    }
  };

  // src/components/FbPlaylistTabs.ts
  var _FbPlaylistTabs = class _FbPlaylistTabs extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._activeIndex = -1;
      this._playlists = [];
      this._dragState = null;
      this._resizeState = null;
      this._tabWidths = {};
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:flex;overflow:hidden;align-items:stretch;width:100%;min-width:0}[part=tabs-container]{display:flex;flex:1;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}[part=tabs-container]::-webkit-scrollbar{display:none}[part=tab]{cursor:pointer;display:inline-flex;align-items:center;flex-shrink:0;position:relative;box-sizing:border-box;user-select:none}[part=drop-indicator]{position:absolute;top:0;bottom:0;width:2px;pointer-events:none;display:none;z-index:1}[part=add-button]{cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;user-select:none}</style><div part="tabs-container" role="tablist"><div part="drop-indicator"></div></div><div part="add-button" role="button" tabindex="0" aria-label="New playlist">+</div>`;
      this._container = this._$("[part=tabs-container]");
      this._dropIndicator = this._$("[part=drop-indicator]");
      this._addBtn = this._$("[part=add-button]");
      try {
        const saved = localStorage.getItem(_FbPlaylistTabs.STORAGE_KEY);
        if (saved) this._tabWidths = JSON.parse(saved);
      } catch {
      }
    }
    _setupEvents() {
      this._listen(this._container, "click", (e) => {
        if (this._dragState?.started) return;
        const tab = e.target?.closest(
          "[part=tab]"
        );
        if (!tab) return;
        const index = parseInt(tab.dataset.index || "-1", 10);
        if (!isNaN(index)) void this._activatePlaylist(index);
      });
      this._listen(this._container, "contextmenu", (e) => {
        const tab = e.target?.closest(
          "[part=tab]"
        );
        if (!tab) return;
        e.preventDefault();
        const index = parseInt(tab.dataset.index || "-1", 10);
        this._emit("fb-playlist-context", {
          index,
          x: e.clientX,
          y: e.clientY
        });
        if (this.hasAttribute("native-context")) {
          void this._showNativeMenu(index);
        }
      });
      this._listen(this._container, "keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          const delta = e.key === "ArrowRight" ? 1 : -1;
          const newIndex = Math.max(
            0,
            Math.min(
              this._playlists.length - 1,
              this._activeIndex + delta
            )
          );
          void this._activatePlaylist(newIndex);
        }
      });
      this._listen(this._container, "pointerdown", (e) => {
        if (e.button !== 0) return;
        const tab = e.target?.closest(
          "[part=tab]"
        );
        if (!tab) return;
        const index = parseInt(tab.dataset.index || "-1", 10);
        if (isNaN(index)) return;
        const rect = tab.getBoundingClientRect();
        const isResizeEdge = e.clientX >= rect.right - _FbPlaylistTabs.RESIZE_EDGE;
        if (isResizeEdge) {
          e.preventDefault();
          tab.setPointerCapture(e.pointerId);
          this._resizeState = {
            tabEl: tab,
            startX: e.clientX,
            startWidth: rect.width,
            index,
            pointerId: e.pointerId
          };
        } else {
          this._dragState = {
            tabEl: tab,
            startX: e.clientX,
            startY: e.clientY,
            index,
            started: false,
            pointerId: e.pointerId
          };
        }
      });
      this._listen(this._container, "pointermove", (e) => {
        if (this._resizeState && e.pointerId === this._resizeState.pointerId) {
          const { tabEl, startX: startX2, startWidth } = this._resizeState;
          const delta = e.clientX - startX2;
          const newWidth = Math.max(40, startWidth + delta);
          tabEl.style.width = newWidth + "px";
          return;
        }
        if (!this._dragState || e.pointerId !== this._dragState.pointerId)
          return;
        const { startX, startY, started } = this._dragState;
        if (!started) {
          const dx = Math.abs(e.clientX - startX);
          const dy = Math.abs(e.clientY - startY);
          if (dx < _FbPlaylistTabs.DRAG_THRESHOLD && dy < _FbPlaylistTabs.DRAG_THRESHOLD)
            return;
          this._dragState.started = true;
          this.setAttribute("dragging", "");
          this._dragState.tabEl.setPointerCapture(e.pointerId);
        }
        this._updateDropPosition(e.clientX);
      });
      this._listen(this._container, "pointerup", (e) => {
        if (this._resizeState && e.pointerId === this._resizeState.pointerId) {
          const { tabEl, index } = this._resizeState;
          const name = this._playlists[index]?.name;
          if (name) {
            this._tabWidths[name] = tabEl.getBoundingClientRect().width;
            this._saveTabWidths();
          }
          this._resizeState = null;
          return;
        }
        if (!this._dragState || e.pointerId !== this._dragState.pointerId)
          return;
        const ds = this._dragState;
        this._dragState = null;
        this.removeAttribute("dragging");
        this._dropIndicator.style.display = "none";
        if (!ds.started) return;
        const dropIdx = this._calcDropIndex(e.clientX);
        if (dropIdx === -1 || dropIdx === ds.index) return;
        void this._reorderPlaylists(ds.index, dropIdx);
      });
      this._listen(this._container, "pointercancel", () => {
        if (this._resizeState) this._resizeState = null;
        if (this._dragState) {
          this._dragState = null;
          this.removeAttribute("dragging");
          this._dropIndicator.style.display = "none";
        }
      });
      this._listen(
        this,
        "wheel",
        (e) => {
          if (this._container.scrollWidth <= this._container.clientWidth)
            return;
          e.preventDefault();
          this._container.scrollLeft += e.deltaY || e.deltaX;
        },
        { passive: false }
      );
      this._listen(this._addBtn, "click", () => {
        void (async () => {
          try {
            await getFb().playlist.create("New Playlist");
            this._emit("fb-playlist-add", {});
          } catch {
          }
        })();
      });
      this._listen(this._container, "mousemove", (e) => {
        const tab = e.target?.closest(
          "[part=tab]"
        );
        if (!tab) {
          this._container.style.cursor = "";
          return;
        }
        const rect = tab.getBoundingClientRect();
        tab.style.cursor = e.clientX >= rect.right - _FbPlaylistTabs.RESIZE_EDGE ? "col-resize" : "pointer";
      });
    }
    async _showNativeMenu(index) {
      try {
        const fb = getFb();
        await fb.playlist.setActive(index);
        await fb.menu.showNativePopup({ mode: "playlist" });
      } catch {
      }
    }
    _updateDropPosition(clientX) {
      const tabs = this._$$("[part=tab]");
      let insertBefore = -1;
      for (let i = 0; i < tabs.length; i++) {
        const r = tabs[i].getBoundingClientRect();
        if (clientX < r.left + r.width / 2) {
          insertBefore = i;
          break;
        }
      }
      if (insertBefore === -1) insertBefore = tabs.length;
      const containerRect = this._container.getBoundingClientRect();
      let indicatorLeft;
      if (insertBefore < tabs.length) {
        indicatorLeft = tabs[insertBefore].getBoundingClientRect().left - containerRect.left + this._container.scrollLeft;
      } else if (tabs.length > 0) {
        const last = tabs[tabs.length - 1].getBoundingClientRect();
        indicatorLeft = last.right - containerRect.left + this._container.scrollLeft;
      } else {
        indicatorLeft = 0;
      }
      this._dropIndicator.style.display = "block";
      this._dropIndicator.style.left = indicatorLeft + "px";
    }
    _calcDropIndex(clientX) {
      const tabs = this._$$("[part=tab]");
      for (let i = 0; i < tabs.length; i++) {
        const r = tabs[i].getBoundingClientRect();
        if (clientX < r.left + r.width / 2) return i;
      }
      return tabs.length > 0 ? tabs.length : -1;
    }
    async _reorderPlaylists(fromIndex, toIndex) {
      const count = this._playlists.length;
      const order = [];
      for (let i = 0; i < count; i++) order.push(i);
      const [removed] = order.splice(fromIndex, 1);
      const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
      order.splice(insertAt, 0, removed);
      try {
        await getFb().playlist.reorderPlaylists(order);
        this._emit("fb-playlist-reorder", {
          fromIndex,
          toIndex,
          newOrder: order
        });
      } catch {
      }
    }
    _saveTabWidths() {
      try {
        localStorage.setItem(
          _FbPlaylistTabs.STORAGE_KEY,
          JSON.stringify(this._tabWidths)
        );
      } catch {
      }
    }
    _applyTabWidths() {
      const tabs = this._$$("[part=tab]");
      tabs.forEach((tab, i) => {
        const name = this._playlists[i]?.name;
        const w = name && this._tabWidths[name];
        if (w) tab.style.width = w + "px";
        else tab.style.width = "";
      });
    }
    _checkOverflow() {
      if (this._container.scrollWidth > this._container.clientWidth) {
        this.setAttribute("overflow", "");
      } else {
        this.removeAttribute("overflow");
      }
    }
    async _activatePlaylist(index) {
      try {
        await getFb().playlist.setActive(index);
        this._emit("fb-playlist-select", {
          index
        });
      } catch {
      }
    }
    _subscribe() {
      const refresh = () => {
        void this._loadPlaylists();
      };
      this._sub("playlist:created", refresh);
      this._sub("playlist:removed", refresh);
      this._sub("playlist:renamed", refresh);
      this._sub("playlist:reordered", refresh);
      this._sub("playlist:itemsAdded", refresh);
      this._sub("playlist:itemsRemoved", refresh);
      this._sub("playlist:activated", (data) => {
        this._activeIndex = data?.newIndex ?? -1;
        this._updateActive();
      });
      void this._loadPlaylists();
    }
    async _loadPlaylists() {
      try {
        const result = await getFb().playlist.getAll();
        this._playlists = result ?? [];
        this._activeIndex = this._playlists.findIndex((p) => p.isActive);
        this._rebuildTabs();
      } catch {
      }
    }
    _rebuildTabs() {
      const indicatorEl = this._dropIndicator;
      this._container.innerHTML = this._playlists.map(
        (pl, i) => `<div part="tab" data-index="${i}" role="tab" tabindex="${i === this._activeIndex ? "0" : "-1"}" aria-selected="${i === this._activeIndex}"${pl.isLocked ? " locked" : ""}><span part="tab-name">${this._escHtml(pl.name)}</span><span part="tab-count">${pl.trackCount}</span></div>`
      ).join("");
      this._container.appendChild(indicatorEl);
      this.setAttribute("active-index", this._activeIndex.toString());
      this.setAttribute("count", this._playlists.length.toString());
      this._applyTabWidths();
      requestAnimationFrame(() => this._checkOverflow());
    }
    _updateActive() {
      const tabs = this._$$("[part=tab]");
      tabs.forEach((tab) => {
        const i = parseInt(tab.dataset.index || "-1", 10);
        const active = i === this._activeIndex;
        tab.setAttribute("aria-selected", active.toString());
        tab.setAttribute("tabindex", active ? "0" : "-1");
      });
      this.setAttribute("active-index", this._activeIndex.toString());
      const activeTab = this._$(
        '[part=tab][aria-selected="true"]'
      );
      if (activeTab)
        activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };
  _FbPlaylistTabs.DRAG_THRESHOLD = 5;
  /** Width of the right-edge zone that triggers resize (pixels). */
  _FbPlaylistTabs.RESIZE_EDGE = 5;
  _FbPlaylistTabs.STORAGE_KEY = "fb-playlist-tab-widths";
  var FbPlaylistTabs = _FbPlaylistTabs;

  // src/components/FbPlaylistView.ts
  var FbPlaylistView = class _FbPlaylistView extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._playlistIndex = -1;
      this._trackCount = 0;
      this._columns = [
        "index",
        "title",
        "artist",
        "album",
        "duration"
      ];
      this._rowHeight = 32;
      this._selection = /* @__PURE__ */ new Set();
      this._focusedIndex = -1;
      this._shiftAnchor = -1;
      this._playingIndex = -1;
      this._scrollTop = 0;
      this._visibleRows = [];
      this._dataCache = /* @__PURE__ */ new Map();
      this._rafId = null;
      this._loadingRange = false;
      this._gridTemplate = "";
      this._formats = {};
      this._resizeObserver = null;
    }
    /**
     * Column-id → track-property mapping.
     *
     * Accepts both the snake_case / camelCase IDs the host emits and the
     * Chinese column IDs that `foo_playcount` exposes to other components.
     * The Chinese entries are **data identifiers**, not UI labels, and
     * must be kept verbatim so that playlist columns authored with
     * `foo_playcount`'s default localised headers resolve to the right
     * track property.
     */
    static get _colMap() {
      return {
        album_artist: "albumArtist",
        tracknumber: "trackNumber",
        discnumber: "discNumber",
        samplerate: "sampleRate",
        filesize: "fileSize",
        // foo_playcount English ids
        play_count: "playCount",
        first_played: "firstPlayed",
        last_played: "lastPlayed",
        // foo_playcount Chinese ids (external data keys, not UI text)
        \u64AD\u653E\u6B21\u6570: "playCount",
        \u9996\u6B21\u64AD\u653E: "firstPlayed",
        \u6700\u8FD1\u64AD\u653E: "lastPlayed",
        \u6DFB\u52A0\u65E5\u671F: "added",
        \u7B49\u7EA7: "rating"
      };
    }
    static get observedAttributes() {
      return ["playlist", "columns", "row-height", "grid-template", "formats"];
    }
    attributeChangedCallback(name) {
      if (!this._domReady) return;
      if (name === "columns") {
        this._columns = (this.getAttribute("columns") || "index,title,artist,album,duration").split(",").map((s) => s.trim());
        this._visibleRows.forEach((r) => {
          r._built = false;
        });
        this._updateRows();
      } else if (name === "row-height") {
        this._rowHeight = parseInt(this.getAttribute("row-height") || "32", 10) || 32;
        this._recalcLayout();
      } else if (name === "playlist") {
        void this._loadPlaylist();
      } else if (name === "grid-template") {
        this._gridTemplate = this.getAttribute("grid-template") || "";
        this._applyGridToRows();
      } else if (name === "formats") {
        try {
          this._formats = JSON.parse(
            this.getAttribute("formats") || "{}"
          );
        } catch {
          this._formats = {};
        }
        this._dataCache.clear();
        this._updateRows();
      }
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      this._rowHeight = parseInt(this.getAttribute("row-height") || "32", 10) || 32;
      this._columns = (this.getAttribute("columns") || "index,title,artist,album,duration").split(",").map((s) => s.trim());
      this._gridTemplate = this.getAttribute("grid-template") || "";
      try {
        this._formats = JSON.parse(this.getAttribute("formats") || "{}");
      } catch {
        this._formats = {};
      }
      const plAttr = this.getAttribute("playlist");
      if (plAttr !== null) this._playlistIndex = parseInt(plAttr, 10);
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:block;overflow:hidden}[part=viewport]{overflow-y:auto;position:relative;height:100%}[part=viewport]::-webkit-scrollbar{width:6px}[part=scroll-content]{position:relative}[part=row]{position:absolute;left:0;right:0;display:flex;align-items:center;cursor:default}[part=row]>*{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}[part=row][data-grid]{display:grid;align-items:center;gap:0!important}</style><div part="viewport"><div part="scroll-content"></div></div>`;
      this._viewport = this._$("[part=viewport]");
      this._scrollContent = this._$("[part=scroll-content]");
    }
    _setupEvents() {
      this._listen(this._viewport, "scroll", () => {
        if (this._rafId) return;
        this._rafId = requestAnimationFrame(() => {
          this._rafId = null;
          this._onScroll();
        });
      });
      this._resizeObserver = new ResizeObserver(() => {
        if (this._trackCount > 0) this._recalcLayout();
      });
      this._resizeObserver.observe(this._viewport);
      this._listen(this._viewport, "click", (e) => {
        const row = e.target?.closest(
          "[part=row]"
        );
        if (!row) return;
        const idx = parseInt(row.dataset.index || "-1", 10);
        if (isNaN(idx)) return;
        this._handleSelect(idx, e.ctrlKey || e.metaKey, e.shiftKey);
      });
      this._listen(this._viewport, "dblclick", (e) => {
        const row = e.target?.closest(
          "[part=row]"
        );
        if (!row) return;
        const idx = parseInt(row.dataset.index || "-1", 10);
        if (!isNaN(idx)) void this._playTrack(idx);
      });
      this._listen(this._viewport, "contextmenu", (e) => {
        void (async () => {
          const row = e.target?.closest("[part=row]");
          e.preventDefault();
          if (row) {
            const idx = parseInt(row.dataset.index || "-1", 10);
            if (!isNaN(idx) && !this._selection.has(idx)) {
              this._handleSelect(idx, false, false);
            }
          }
          await this._syncSelection();
          this._emit("fb-track-context", {
            indices: [...this._selection],
            x: e.clientX,
            y: e.clientY
          });
        })();
      });
      this._listen(this._viewport, "keydown", (e) => {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            this._moveFocus(1, e.shiftKey);
            break;
          case "ArrowUp":
            e.preventDefault();
            this._moveFocus(-1, e.shiftKey);
            break;
          case "Enter":
            if (this._focusedIndex >= 0)
              void this._playTrack(this._focusedIndex);
            break;
          case "Delete":
            void this._deleteSelected();
            break;
          case "a":
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              this._selectAll();
            }
            break;
        }
      });
    }
    // ─── Selection model ───────────────────────────────────────────
    _handleSelect(index, ctrlKey, shiftKey) {
      if (shiftKey && this._shiftAnchor >= 0) {
        const from = Math.min(this._shiftAnchor, index);
        const to = Math.max(this._shiftAnchor, index);
        if (!ctrlKey) this._selection.clear();
        for (let i = from; i <= to; i++) this._selection.add(i);
      } else if (ctrlKey) {
        if (this._selection.has(index)) this._selection.delete(index);
        else this._selection.add(index);
        this._shiftAnchor = index;
      } else {
        this._selection.clear();
        this._selection.add(index);
        this._shiftAnchor = index;
      }
      this._focusedIndex = index;
      void this._syncSelection();
      this._updateRows();
      this._emit("fb-track-select", {
        index,
        indices: [...this._selection]
      });
    }
    _moveFocus(delta, shiftKey) {
      const newIdx = Math.max(
        0,
        Math.min(this._trackCount - 1, this._focusedIndex + delta)
      );
      if (newIdx === this._focusedIndex) return;
      this._handleSelect(newIdx, false, shiftKey);
      this._scrollToIndex(newIdx);
    }
    _selectAll() {
      this._selection.clear();
      for (let i = 0; i < this._trackCount; i++) this._selection.add(i);
      void this._syncSelection();
      this._updateRows();
    }
    async _syncSelection() {
      try {
        const pl = await this._getPlaylistIndex();
        await getFb().playlist.setSelection(pl, [...this._selection]);
      } catch {
      }
      this.setAttribute("selected-count", this._selection.size.toString());
    }
    async _deleteSelected() {
      if (this._selection.size === 0) return;
      try {
        const pl = await this._getPlaylistIndex();
        await getFb().playlist.removeTracks(pl, [...this._selection]);
        this._selection.clear();
      } catch {
      }
    }
    async _playTrack(index) {
      try {
        const pl = await this._getPlaylistIndex();
        await getFb().playlist.playTrack(pl, index);
        this._emit("fb-track-play", { index });
      } catch {
      }
    }
    // ─── Grid layout ──────────────────────────────────────────────
    _applyGridToRows() {
      const gt = this._gridTemplate;
      this._visibleRows.forEach((row) => {
        if (gt) {
          row.dataset.grid = "";
          row.style.gridTemplateColumns = gt;
          row.style.gap = "0";
        } else {
          delete row.dataset.grid;
          row.style.gridTemplateColumns = "";
          row.style.gap = "";
        }
      });
    }
    // ─── Virtual scroll ───────────────────────────────────────────
    _onScroll() {
      this._scrollTop = this._viewport.scrollTop;
      this._updateRows();
    }
    _recalcLayout() {
      if (!this._scrollContent) return;
      this._scrollContent.style.height = this._trackCount * this._rowHeight + "px";
      this._updateRows();
    }
    _scrollToIndex(index) {
      const top = index * this._rowHeight;
      const bottom = top + this._rowHeight;
      if (top < this._viewport.scrollTop) {
        this._viewport.scrollTop = top;
      } else if (bottom > this._viewport.scrollTop + this._viewport.clientHeight) {
        this._viewport.scrollTop = bottom - this._viewport.clientHeight;
      }
    }
    _updateRows() {
      if (!this._viewport) return;
      const viewHeight = this._viewport.clientHeight;
      if (viewHeight === 0) return;
      const rh = this._rowHeight;
      const st = this._scrollTop;
      const startIdx = Math.max(0, Math.floor(st / rh) - 2);
      const endIdx = Math.min(
        this._trackCount,
        Math.ceil((st + viewHeight) / rh) + 2
      );
      const needed = endIdx - startIdx;
      const useGrid = !!this._gridTemplate;
      while (this._visibleRows.length < needed) {
        const row = document.createElement("div");
        row.setAttribute("part", "row");
        if (useGrid) {
          row.dataset.grid = "";
          row.style.gridTemplateColumns = this._gridTemplate;
          row.style.gap = "0";
        }
        this._scrollContent.appendChild(row);
        this._visibleRows.push(row);
      }
      for (let i = needed; i < this._visibleRows.length; i++) {
        this._visibleRows[i].style.display = "none";
      }
      let loadMin = Infinity;
      let loadMax = -1;
      for (let vi = 0; vi < needed; vi++) {
        const i = startIdx + vi;
        const row = this._visibleRows[vi];
        row.style.display = "";
        if (useGrid && !row.dataset.grid) {
          row.dataset.grid = "";
          row.style.gridTemplateColumns = this._gridTemplate;
          row.style.gap = "0";
        } else if (!useGrid && row.dataset.grid !== void 0) {
          delete row.dataset.grid;
          row.style.gridTemplateColumns = "";
          row.style.gap = "";
        }
        row.style.top = i * rh + "px";
        row.style.height = rh + "px";
        row.dataset.index = i.toString();
        if (this._selection.has(i)) row.setAttribute("selected", "");
        else row.removeAttribute("selected");
        if (i === this._focusedIndex) row.setAttribute("focused", "");
        else row.removeAttribute("focused");
        if (i === this._playingIndex) row.setAttribute("playing", "");
        else row.removeAttribute("playing");
        const cached = this._dataCache.get(i);
        if (cached) {
          this._fillRow(row, cached, i);
        } else {
          if (i < loadMin) loadMin = i;
          if (i > loadMax) loadMax = i;
          if (!row._empty) {
            row.textContent = "";
            row._empty = true;
          }
        }
      }
      if (loadMax >= 0) void this._loadRange(loadMin, loadMax + 1);
    }
    _fillRow(row, track, index) {
      const isRatingCol = (col) => (
        // `'等级'` is the `foo_playcount` Chinese column ID (data
        // identifier), not UI text — see `_colMap` JSDoc.
        col === "\u7B49\u7EA7" || col === "rating"
      );
      const colKey = this._columns.join(",");
      if (row._built && row._colKey === colKey) {
        this._columns.forEach((col, ci) => {
          const cell = row.children[ci];
          if (!cell) return;
          if (isRatingCol(col))
            this._fillRatingCell(cell, track);
          else cell.textContent = this._getCellValue(track, col, index);
        });
      } else {
        row.innerHTML = this._columns.map((col) => `<span part="row-${col}"></span>`).join("");
        this._columns.forEach((col, ci) => {
          const cell = row.children[ci];
          if (!cell) return;
          if (isRatingCol(col))
            this._fillRatingCell(cell, track);
          else cell.textContent = this._getCellValue(track, col, index);
        });
        row._built = true;
        row._colKey = colKey;
      }
      row._empty = false;
    }
    _fillRatingCell(cell, track) {
      const rating = parseInt(String(track.rating ?? 0), 10) || 0;
      const path = track.absolutePath || track.path || "";
      cell._trackPath = path;
      if (cell._ratingVal === rating && cell._ratingBuilt) return;
      cell._ratingVal = rating;
      cell._ratingBuilt = true;
      cell.innerHTML = "";
      for (let i = 1; i <= 5; i++) {
        const s = document.createElement("span");
        s.dataset.star = i.toString();
        const filled = i <= rating;
        s.textContent = filled ? "\u2605" : "\u2606";
        s.style.cssText = "cursor:pointer;padding:0 1px;display:inline-block";
        if (filled) s.dataset.filled = "";
        cell.appendChild(s);
      }
      if (!cell._ratingHandler) {
        const view = this;
        cell._ratingHandler = (e) => {
          e.stopPropagation();
          const star = e.target?.closest("[data-star]");
          if (!star) return;
          let val = parseInt(star.dataset.star || "0", 10);
          if (val === cell._ratingVal) val = 0;
          void (async () => {
            try {
              await getFb().rating.set(cell._trackPath || "", val);
              cell._ratingVal = val;
              cell.querySelectorAll("[data-star]").forEach(
                (s) => {
                  const v = parseInt(s.dataset.star || "0", 10);
                  const filled = v <= val;
                  s.textContent = filled ? "\u2605" : "\u2606";
                  if (filled) s.dataset.filled = "";
                  else delete s.dataset.filled;
                }
              );
              const rowParent = cell.closest("[part=row]");
              const idx = parseInt(rowParent?.dataset.index || "NaN", 10);
              if (!isNaN(idx)) {
                const cached = view._dataCache.get(idx);
                if (cached) cached.rating = val;
              }
            } catch {
            }
          })();
        };
        cell.addEventListener("click", cell._ratingHandler);
        cell.addEventListener("mouseover", (e) => {
          const star = e.target?.closest("[data-star]");
          if (!star) return;
          const hoverVal = parseInt(star.dataset.star || "0", 10);
          cell.querySelectorAll("[data-star]").forEach((s) => {
            const v = parseInt(s.dataset.star || "0", 10);
            s.textContent = v <= hoverVal ? "\u2605" : "\u2606";
            s.style.color = v <= hoverVal ? "#FFD700" : "";
            s.style.transform = v <= hoverVal ? "scale(1.3)" : "";
          });
        });
        cell.addEventListener("mouseleave", () => {
          const ratingNow = cell._ratingVal || 0;
          cell.querySelectorAll("[data-star]").forEach((s) => {
            const v = parseInt(s.dataset.star || "0", 10);
            const filled = v <= ratingNow;
            s.textContent = filled ? "\u2605" : "\u2606";
            s.style.color = filled ? "#FFD700" : "";
            s.style.transform = "";
          });
        });
      }
    }
    _getCellValue(track, col, index) {
      if (col === "index") return (index + 1).toString();
      if (col === "duration") return formatTime(track.duration || 0);
      if (col === "filename") {
        const p = track.absolutePath || track.path || "";
        return p.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "";
      }
      if (col === "directory") {
        const p = track.absolutePath || track.path || "";
        const parts = p.split(/[\\/]/);
        return parts.length > 1 ? parts[parts.length - 2] : "";
      }
      if (col === "filesize") {
        const sz = track.fileSize ?? 0;
        if (!sz || sz <= 0) return "";
        if (sz < 1024) return sz + " B";
        if (sz < 1048576) return (sz / 1024).toFixed(0) + " KB";
        return (sz / 1048576).toFixed(1) + " MB";
      }
      if (col === "bitrate") {
        return track.bitrate ? track.bitrate + " kbps" : "";
      }
      if (col === "samplerate") {
        return track.sampleRate ? track.sampleRate + " Hz" : "";
      }
      const key = _FbPlaylistView._colMap[col] || col;
      const val = track[key];
      if (val == null || val === 0 && (col === "tracknumber" || col === "discnumber"))
        return "";
      return String(val);
    }
    async _loadRange(start, end) {
      if (this._loadingRange) return;
      this._loadingRange = true;
      try {
        const pl = await this._getPlaylistIndex();
        const fmts = Object.keys(this._formats).length > 0 ? this._formats : void 0;
        const arr = await getFb().playlist.getTracks(
          pl,
          start,
          end - start,
          fmts
        );
        arr.forEach((t, i) => {
          this._dataCache.set(start + i, t);
        });
        if (arr.length > 0) this._updateRows();
      } catch {
      } finally {
        this._loadingRange = false;
      }
    }
    async _getPlaylistIndex() {
      if (this._playlistIndex >= 0) return this._playlistIndex;
      try {
        const r = await getFb().playlist.getActive();
        if (r == null) return 0;
        if (typeof r === "number") return r;
        if (typeof r.playlist === "number") return r.playlist;
        if (typeof r.index === "number") return r.index;
        if (typeof r.active === "number") return r.active;
        return 0;
      } catch {
        return 0;
      }
    }
    // ─── Subscriptions ───────────────────────────────────────────
    _subscribe() {
      const reloadData = () => {
        this._dataCache.clear();
        void this._loadPlaylist();
      };
      this._sub("playlist:itemsAdded", reloadData);
      this._sub("playlist:itemsRemoved", reloadData);
      this._sub("playlist:itemsReordered", reloadData);
      this._sub("playlist:itemsReplaced", reloadData);
      this._sub("playlist:selectionChanged", () => {
        void this._loadExternalSelection();
      });
      this._sub("playlist:focusChanged", (data) => {
        const to = data?.to;
        if (to !== void 0) {
          this._focusedIndex = to;
          this._updateRows();
        }
      });
      this._sub("playlist:activated", () => {
        if (this._playlistIndex < 0) {
          this._dataCache.clear();
          void this._loadPlaylist();
        }
      });
      this._sub("playback:trackChanged", (data) => {
        this._playingIndex = data?.index ?? -1;
        this._updateRows();
      });
      void this._loadPlaylist();
    }
    async _loadPlaylist() {
      try {
        const pl = await this._getPlaylistIndex();
        const r = await getFb().playlist.getCount(pl);
        this._trackCount = typeof r === "object" && r !== null && r.count || (typeof r === "number" ? r : 0) || 0;
        this.setAttribute("track-count", this._trackCount.toString());
        this._recalcLayout();
      } catch {
      }
    }
    async _loadExternalSelection() {
      try {
        const pl = await this._getPlaylistIndex();
        const sel = await getFb().playlist.getSelection(pl);
        this._selection = new Set(sel?.items || []);
        this.setAttribute(
          "selected-count",
          this._selection.size.toString()
        );
        this._updateRows();
      } catch {
      }
    }
    disconnectedCallback() {
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      super.disconnectedCallback();
    }
  };

  // src/components/FbPopupPanel.ts
  var FbPopupPanel = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._windowId = null;
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}</style><slot></slot>`;
      this._windowId = null;
    }
    _setupEvents() {
      this._listen(this, "click", () => {
        if (!this._windowId) void this.open();
      });
    }
    _subscribe() {
      this._sub("window:popupClosed", (data) => {
        const d = data;
        if (d?.windowId === this._windowId) {
          const closedId = this._windowId;
          this._windowId = null;
          this.removeAttribute("open");
          if (closedId)
            this._emit("fb-popup-close", {
              windowId: closedId
            });
        }
      });
      this._sub("window:message", (data) => {
        this._emit(
          "fb-popup-message",
          data
        );
      });
    }
    /**
     * Open the popup window declared by this element's attributes.
     * Subsequent calls while a popup is already open are no-ops.
     *
     * @returns the popup `windowId` once it's open, or `null` on
     * failure.
     */
    async open() {
      if (this._windowId) return this._windowId;
      try {
        const result = await getFb().ui.createPopup({
          url: this.getAttribute("url") || "",
          width: parseInt(this.getAttribute("width") || "400", 10) || 400,
          height: parseInt(this.getAttribute("height") || "300", 10) || 300,
          title: this.getAttribute("popup-title") || "",
          resizable: this.getAttribute("resizable") !== "false",
          alwaysOnTop: this.hasAttribute("always-on-top"),
          showInTaskbar: this.hasAttribute("show-in-taskbar"),
          frame: this.getAttribute("frame") !== "false",
          transparent: this.hasAttribute("transparent"),
          beforeClose: this.hasAttribute("before-close")
        });
        if (result?.success && result.windowId) {
          this._windowId = result.windowId;
          this.setAttribute("open", "");
          this.setAttribute("window-id", this._windowId);
          this._emit("fb-popup-open", {
            windowId: this._windowId
          });
        }
        return this._windowId;
      } catch {
        return null;
      }
    }
    /** Close the popup if open. No-op otherwise. */
    async close() {
      if (!this._windowId) return;
      try {
        await getFb().ui.closePopup(this._windowId);
      } catch {
      }
    }
    /** Current popup window id, or `null` if no popup is open. */
    get windowId() {
      return this._windowId;
    }
    disconnectedCallback() {
      if (this._windowId) {
        getFb().ui.closePopup(this._windowId).catch(() => {
        });
      }
      super.disconnectedCallback();
    }
  };

  // src/components/FbPrevButton.ts
  var FbPrevButton = class extends FbBaseElement {
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}</style><button part="button" role="button" tabindex="0" aria-label="Previous"><slot>\u23EE</slot></button>`;
      this._btn = this._$("button");
    }
    _setupEvents() {
      this._listen(this._btn, "click", () => {
        void this._handleClick();
      });
      this._listen(this._btn, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void this._handleClick();
        }
      });
    }
    async _handleClick() {
      try {
        await getFb().player.prev();
        this._emit("fb-prev", {});
      } catch {
      }
    }
  };

  // src/components/FbPropertiesPanel.ts
  var FbPropertiesPanel = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._trackPath = null;
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:block;overflow-y:auto}</style><div part="container"></div>`;
      this._container = this._$("[part=container]");
    }
    _setupEvents() {
    }
    _subscribe() {
      const path = this.getAttribute("path");
      if (!path) {
        this._sub("playback:trackChanged", () => {
          void this._loadProperties();
        });
      }
      void this._loadProperties();
    }
    async _loadProperties() {
      const fb = getFb();
      try {
        let path = this.getAttribute("path");
        if (!path) {
          const track = await fb.player.getCurrentTrack();
          path = track?.path ?? null;
        }
        if (!path || path === this._trackPath) return;
        this._trackPath = path;
        const result = await fb.metadata.read(path);
        if (!result?.success) return;
        const groups = (this.getAttribute("groups") || "metadata,technical,location").split(",");
        let html = "";
        if (groups.includes("metadata") && result.tags) {
          html += this._buildGroup("metadata", "Metadata", result.tags, [
            "TITLE",
            "ARTIST",
            "ALBUM",
            "ALBUMARTIST",
            "DATE",
            "GENRE",
            "TRACKNUMBER",
            "COMMENT"
          ]);
        }
        if (groups.includes("technical")) {
          const info = result.info || {};
          const channelLabel = info.channels === 2 ? "Stereo" : info.channels === 1 ? "Mono" : info.channels ? `${info.channels}ch` : "";
          const tech = {
            Codec: info.codec || "",
            Bitrate: info.bitrate ? `${info.bitrate} kbps` : "",
            "Sample Rate": info.sampleRate ? `${info.sampleRate} Hz` : "",
            Channels: channelLabel,
            Duration: info.duration ? formatTime(info.duration) : ""
          };
          html += this._buildGroup("technical", "Technical", tech);
        }
        if (groups.includes("location")) {
          html += this._buildGroup("location", "Location", { Path: path });
        }
        this._container.innerHTML = html;
        this.setAttribute("track-path", path);
      } catch {
      }
    }
    _buildGroup(id, title, data, keys) {
      const entries = keys ? keys.map((k) => [k, data[k]]).filter(([, v]) => v !== void 0 && v !== null && v !== "") : Object.entries(data).filter(
        ([, v]) => v !== void 0 && v !== null && v !== ""
      );
      if (entries.length === 0) return "";
      return `<div part="group" data-group="${id}"><div part="group-title">${this._escHtml(title)}</div>` + entries.map(
        ([k, v]) => `<div part="row"><span part="label">${this._escHtml(k)}</span><span part="value">${this._escHtml(String(v))}</span></div>`
      ).join("") + `</div>`;
    }
  };

  // src/components/FbQueueView.ts
  var FbQueueView = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._columns = ["index", "title", "artist", "duration"];
      this._items = [];
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      const cols = (this.getAttribute("columns") || "index,title,artist,duration").split(",").map((s) => s.trim());
      this._columns = cols;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:block;overflow-y:auto}[part=container]{display:flex;flex-direction:column}[part=row]{display:flex;align-items:center;cursor:default}[part=empty]{display:none}:host([empty]) [part=empty]{display:block}:host([empty]) [part=container]{display:none}</style><div part="container"></div><slot name="empty" part="empty"></slot>`;
      this._container = this._$("[part=container]");
    }
    _setupEvents() {
      this._listen(this._container, "contextmenu", (e) => {
        const row = e.target?.closest(
          "[part=row]"
        );
        if (!row) return;
        e.preventDefault();
        const idx = parseInt(row.dataset.index || "-1", 10);
        this._emit("fb-queue-context", {
          index: idx,
          x: e.clientX,
          y: e.clientY
        });
      });
      this._listen(this._container, "dblclick", (e) => {
        const row = e.target?.closest(
          "[part=row]"
        );
        if (!row) return;
        const idx = parseInt(row.dataset.index || "-1", 10);
        void this._removeItem(idx);
      });
    }
    async _removeItem(index) {
      try {
        await getFb().queue.remove(index);
        this._emit("fb-queue-remove", { index });
      } catch {
      }
    }
    _subscribe() {
      this._sub("playback:queueChanged", () => {
        void this._loadQueue();
      });
      void this._loadQueue();
    }
    async _loadQueue() {
      try {
        const result = await getFb().queue.get();
        this._items = result?.items ?? [];
      } catch {
        this._items = [];
      }
      this._rebuildRows();
    }
    _rebuildRows() {
      if (this._items.length === 0) {
        this.setAttribute("empty", "");
        this._container.innerHTML = "";
        this.setAttribute("count", "0");
        return;
      }
      this.removeAttribute("empty");
      this._container.innerHTML = this._items.map(
        (item, i) => `<div part="row" data-index="${i}">` + this._columns.map((col) => {
          let val = "";
          if (col === "index") val = (i + 1).toString();
          else if (col === "duration")
            val = formatTime(item.duration || 0);
          else
            val = item[col] != null ? String(item[col]) : "";
          return `<span part="row-${col}">${this._escHtml(val)}</span>`;
        }).join("") + `</div>`
      ).join("");
      this.setAttribute("count", this._items.length.toString());
    }
  };

  // src/components/FbRating.ts
  var FbRating = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._currentPath = "";
      this._currentRating = 0;
    }
    static get observedAttributes() {
      return ["max", "readonly"];
    }
    attributeChangedCallback(name) {
      if (!this._domReady) return;
      if (name === "max") {
        this._abortController.abort();
        this._abortController = new AbortController();
        this._buildDOM();
        this._setupEvents();
        this._updateStars();
      }
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      const max = parseInt(this.getAttribute("max") || "5", 10) || 5;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:inline-flex}[part=star]{cursor:pointer;display:inline-block}:host([readonly]) [part=star]{cursor:default}</style><div part="stars">` + Array.from(
        { length: max },
        (_, i) => `<span part="star" data-value="${i + 1}" role="radio" tabindex="0" aria-label="${i + 1} star" aria-checked="false">\u2606</span>`
      ).join("") + `</div>`;
      this._stars = this._$("[part=stars]");
    }
    _setupEvents() {
      this._listen(this._stars, "click", (e) => {
        if (this.hasAttribute("readonly")) return;
        const star = e.target?.closest(
          "[part=star]"
        );
        if (!star) return;
        const value = parseInt(star.dataset.value || "0", 10);
        void this._setRating(value);
      });
      this._listen(this._stars, "keydown", (e) => {
        if (this.hasAttribute("readonly")) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        const star = e.target?.closest(
          "[part=star]"
        );
        if (!star) return;
        e.preventDefault();
        void this._setRating(parseInt(star.dataset.value || "0", 10));
      });
      this._listen(this._stars, "mouseover", (e) => {
        if (this.hasAttribute("readonly")) return;
        const star = e.target?.closest(
          "[part=star]"
        );
        if (!star) return;
        const hoverVal = parseInt(star.dataset.value || "0", 10);
        this._$$("[part=star]").forEach((s) => {
          const v = parseInt(s.dataset.value || "0", 10);
          s.textContent = v <= hoverVal ? "\u2605" : "\u2606";
          if (v <= hoverVal) s.dataset.filled = "";
          else delete s.dataset.filled;
        });
      });
      this._listen(this._stars, "mouseleave", () => {
        if (this.hasAttribute("readonly")) return;
        this._updateStars();
      });
    }
    async _setRating(value) {
      let next = value;
      if (next === this._currentRating) next = 0;
      try {
        await getFb().rating.set(this._currentPath, next);
        this._currentRating = next;
        this._updateStars();
        this._emit("fb-rating-change", {
          value: next,
          path: this._currentPath
        });
      } catch {
      }
    }
    _subscribe() {
      this._sub("playback:trackChanged", (data) => {
        const d = data;
        this._currentPath = d?.path || d?.absolutePath || "";
        void this._loadRating();
      });
      getFb().player.getCurrentTrack().then((t) => {
        const tt = t;
        this._currentPath = tt?.path || tt?.absolutePath || "";
        void this._loadRating();
      }).catch(() => {
      });
    }
    async _loadRating() {
      if (!this._currentPath) {
        this._currentRating = 0;
        this._updateStars();
        return;
      }
      try {
        const result = await getFb().rating.get(this._currentPath);
        this._currentRating = result?.rating || 0;
      } catch {
        this._currentRating = 0;
      }
      this._updateStars();
    }
    _updateStars() {
      this.setAttribute("value", this._currentRating.toString());
      const stars = this._$$("[part=star]");
      stars.forEach((star) => {
        const val = parseInt(star.dataset.value || "0", 10);
        const filled = val <= this._currentRating;
        star.textContent = filled ? "\u2605" : "\u2606";
        if (filled) star.dataset.filled = "";
        else delete star.dataset.filled;
        star.setAttribute("aria-checked", filled.toString());
      });
    }
  };

  // src/components/FbReplaygainSelector.ts
  var FbReplaygainSelector = class extends FbBaseElement {
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}select{all:unset}</style><select part="select" aria-label="ReplayGain mode"><option value="none">Off</option><option value="track">Track</option><option value="album">Album</option><option value="auto">Auto</option></select>`;
      this._select = this._$("select");
    }
    _setupEvents() {
      this._listen(this._select, "change", () => {
        const mode = this._select.value;
        void (async () => {
          try {
            await getFb().replaygain.setMode(mode);
          } catch {
          }
        })();
        this.setAttribute("mode", mode);
        this._emit("fb-replaygain-change", {
          mode
        });
      });
    }
    _subscribe() {
      this._sub("audio:replaygainModeChanged", (data) => {
        const modeNum = data?.mode ?? 0;
        const name = RG_MODE_NAMES[modeNum] || "none";
        this._updateSelection(name);
      });
      getFb().replaygain.getMode().then((r) => {
        const result = r;
        this._updateSelection(result?.sourceMode || "none");
      }).catch(() => {
      });
    }
    _updateSelection(mode) {
      this._select.value = mode;
      this.setAttribute("mode", mode);
    }
  };

  // src/components/FbRepeatButton.ts
  var FbRepeatButton = class extends FbBaseElement {
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}</style><button part="button" role="button" tabindex="0" aria-label="Repeat"><slot name="off">\u{1F501}</slot><slot name="playlist" hidden>\u{1F501}</slot><slot name="track" hidden>\u{1F502}</slot></button>`;
      this._btn = this._$("button");
      this._offSlot = this._$("slot[name=off]");
      this._plSlot = this._$("slot[name=playlist]");
      this._trackSlot = this._$("slot[name=track]");
    }
    _setupEvents() {
      this._listen(this._btn, "click", () => {
        void this._handleClick();
      });
      this._listen(this._btn, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void this._handleClick();
        }
      });
    }
    async _handleClick() {
      try {
        const fb = getFb();
        const current = await fb.player.getOrder();
        let newOrder;
        if (current.order === 1) newOrder = 2;
        else if (current.order === 2) newOrder = 0;
        else newOrder = 1;
        await fb.player.setOrder(newOrder);
        this._emit("fb-repeat-change", {
          mode: this._orderToMode(newOrder),
          order: newOrder
        });
      } catch {
      }
    }
    _subscribe() {
      this._sub("playback:orderChanged", (data) => {
        this._update(data?.orderIndex ?? 0);
      });
      getFb().player.getOrder().then((r) => this._update(r.order)).catch(() => {
      });
    }
    _update(order) {
      const mode = this._orderToMode(order);
      this.setAttribute("mode", mode);
      this._offSlot.hidden = mode !== "off";
      this._plSlot.hidden = mode !== "playlist";
      this._trackSlot.hidden = mode !== "track";
    }
    _orderToMode(order) {
      if (order === 1) return "playlist";
      if (order === 2) return "track";
      return "off";
    }
  };

  // src/components/FbResizableHeader.ts
  var FbResizableHeader = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._cols = [];
      this._colWidths = [];
      this._sortCol = null;
      this._sortDir = "asc";
      this._widthsResolved = false;
      this._drag = {
        active: false,
        colIdx: -1,
        startX: 0,
        startY: 0,
        isDragging: false,
        dropTarget: -1,
        dropPos: null
      };
      this._rz = {
        active: false,
        colIdx: -1,
        startX: 0,
        startW: 0
      };
      this._ro = null;
    }
    static get observedAttributes() {
      return ["columns", "sort-column", "sort-direction"];
    }
    attributeChangedCallback(name) {
      if (!this._domReady) return;
      if (name === "columns") {
        this._parseColumns();
        this._rebuildCells();
      } else if (name === "sort-column") {
        this._sortCol = this.getAttribute("sort-column");
        this._updateSortAttrs();
      } else if (name === "sort-direction") {
        this._sortDir = this.getAttribute("sort-direction") || "asc";
        this._updateSortAttrs();
      }
    }
    /** Current `grid-template-columns` CSS value (fr or px). */
    get gridTemplate() {
      if (!this._widthsResolved || this._colWidths.length === 0) {
        return this._cols.map((c) => c.width || "1fr").join(" ");
      }
      return this._colWidths.map((w) => w + "px").join(" ");
    }
    /** Column id list in current visual order. */
    get columnIds() {
      return this._cols.map((c) => c.id);
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      this._sortCol = this.getAttribute("sort-column");
      this._sortDir = this.getAttribute("sort-direction") || "asc";
      root.innerHTML = // Structure only — themes own:
      //   - `[part=sort-icon]` spacing (use theme-side gap / margin)
      //   - `[part=drop-indicator]` / `[part=drag-ghost]` transitions
      //     and colours (themes opt into opacity animations themselves)
      `<style>${FbBaseElement.baseCSS}:host{display:block;user-select:none}[part=header]{display:grid;align-items:center;position:relative}[part~=cell]{display:flex;align-items:center;min-width:0;position:relative;cursor:default;box-sizing:border-box}[part=resize-handle]{position:absolute;top:0;right:-4px;width:8px;height:100%;cursor:col-resize;z-index:5}[part=sort-icon]{display:inline-flex;flex-shrink:0}[part=drop-indicator]{position:absolute;top:0;bottom:0;width:3px;pointer-events:none;opacity:0;z-index:20}[part=drag-ghost]{position:fixed;pointer-events:none;z-index:10000;white-space:nowrap;opacity:0}</style><div part="header"></div><div part="drop-indicator"></div><div part="drag-ghost"></div>`;
      this._headerEl = this._$("[part=header]");
      this._dropEl = this._$("[part=drop-indicator]");
      this._ghostEl = this._$("[part=drag-ghost]");
      this._parseColumns();
      this._rebuildCells();
    }
    _parseColumns() {
      try {
        const attr = this.getAttribute("columns");
        this._cols = attr ? JSON.parse(attr) : [];
      } catch {
        this._cols = [];
      }
      this._widthsResolved = false;
      this._colWidths = [];
    }
    _rebuildCells() {
      let html = "";
      this._cols.forEach((col, i) => {
        const sorted = this._sortCol === col.id;
        const sortable = col.sortable !== false && !col.fixed;
        html += `<div part="cell cell-${col.id}" data-index="${i}" data-col="${col.id}"` + (sorted ? ` aria-sort="${this._sortDir === "desc" ? "descending" : "ascending"}"` : "") + `><span part="label">${this._escHtml(col.label || col.name || col.id)}</span>`;
        if (sortable) {
          html += `<span part="sort-icon${sorted ? " sort-active" : ""}"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 4l4 5H4z"/><path d="M8 12l4-5H4z"/></svg></span>`;
        }
        if (!col.fixed) {
          html += `<div part="resize-handle" data-index="${i}"></div>`;
        }
        html += `</div>`;
      });
      this._headerEl.innerHTML = html;
      this._headerEl.style.gridTemplateColumns = this._cols.map((c) => c.width || "1fr").join(" ");
    }
    _setupEvents() {
      this._listen(this._headerEl, "mousedown", (e) => {
        if (e.button !== 0) return;
        const handle = e.target?.closest(
          "[part=resize-handle]"
        );
        if (handle) {
          e.preventDefault();
          this._startResize(e, parseInt(handle.dataset.index || "-1", 10));
          return;
        }
        const cell = e.target?.closest(
          "[part~=cell]"
        );
        if (cell) {
          const idx = parseInt(cell.dataset.index || "-1", 10);
          const col = this._cols[idx];
          if (!col || col.fixed) return;
          this._startDrag(e, idx);
        }
      });
      this._listen(this._headerEl, "contextmenu", (e) => {
        e.preventDefault();
        this._emit("fb-header-context", {
          x: e.clientX,
          y: e.clientY
        });
      });
      this._ro = new ResizeObserver(() => {
        if (this._widthsResolved && !this._rz.active && !this._drag.isDragging) {
          this._widthsResolved = false;
        }
      });
      this._ro.observe(this._headerEl);
    }
    _subscribe() {
    }
    _resolveWidths() {
      if (this._widthsResolved) return;
      const cells = [...this._$$("[part~=cell]")];
      if (cells.length === 0) return;
      this._colWidths = cells.map((c) => c.offsetWidth);
      this._widthsResolved = true;
    }
    _applyWidths() {
      this._headerEl.style.gridTemplateColumns = this._colWidths.map((w) => w + "px").join(" ");
    }
    /**
     * `document`-level listeners are bound here (not via `_listen`) so
     * the drag tracks cursor motion outside the component's bounding
     * box. Cleanup happens in the paired `onUp` handler.
     */
    _startResize(e, idx) {
      this._resolveWidths();
      this._rz.active = true;
      this._rz.colIdx = idx;
      this._rz.startX = e.clientX;
      this._rz.startW = this._colWidths[idx] ?? 0;
      this.setAttribute("resizing", "");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev) => {
        const delta = ev.clientX - this._rz.startX;
        const newW = Math.max(50, this._rz.startW + delta);
        this._colWidths[this._rz.colIdx] = newW;
        this._applyWidths();
        this._emit("fb-column-resize", {
          column: this._cols[this._rz.colIdx].id,
          width: newW,
          gridTemplate: this.gridTemplate
        });
      };
      const onUp = () => {
        this._rz.active = false;
        this.removeAttribute("resizing");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }
    _startDrag(e, idx) {
      const d = this._drag;
      d.active = true;
      d.colIdx = idx;
      d.startX = e.clientX;
      d.startY = e.clientY;
      d.isDragging = false;
      const onMove = (ev) => {
        const dx = Math.abs(ev.clientX - d.startX);
        const dy = Math.abs(ev.clientY - d.startY);
        if (!d.isDragging && (dx > 5 || dy > 5)) {
          d.isDragging = true;
          this.setAttribute("reordering", "");
          document.body.style.cursor = "grabbing";
          document.body.style.userSelect = "none";
          const col = this._cols[d.colIdx];
          this._ghostEl.textContent = col.label || col.name || col.id;
          this._ghostEl.style.opacity = "1";
        }
        if (!d.isDragging) return;
        this._ghostEl.style.left = ev.clientX + "px";
        this._ghostEl.style.top = ev.clientY + "px";
        const cells = this._$$("[part~=cell]");
        let found = false;
        for (let i = 0; i < cells.length; i++) {
          if (this._cols[i]?.fixed) continue;
          const rect = cells[i].getBoundingClientRect();
          if (ev.clientX >= rect.left && ev.clientX <= rect.right) {
            const mid = rect.left + rect.width / 2;
            d.dropTarget = i;
            d.dropPos = ev.clientX < mid ? "left" : "right";
            const x = d.dropPos === "left" ? rect.left : rect.right;
            const hRect = this._headerEl.getBoundingClientRect();
            this._dropEl.style.left = x - hRect.left - 1 + "px";
            this._dropEl.style.opacity = "1";
            found = true;
            break;
          }
        }
        if (!found) {
          d.dropTarget = -1;
          this._dropEl.style.opacity = "0";
        }
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        const wasDragging = d.isDragging;
        const fromIdx = d.colIdx;
        const dropTarget = d.dropTarget;
        const dropPos = d.dropPos;
        this._ghostEl.style.opacity = "0";
        this._dropEl.style.opacity = "0";
        this.removeAttribute("reordering");
        d.active = false;
        d.isDragging = false;
        if (wasDragging && dropTarget >= 0 && fromIdx !== dropTarget) {
          let toIdx = dropTarget;
          if (dropPos === "right") toIdx++;
          if (fromIdx < toIdx) toIdx--;
          if (toIdx !== fromIdx && toIdx >= 0 && toIdx < this._cols.length) {
            const col = this._cols.splice(fromIdx, 1)[0];
            this._cols.splice(toIdx, 0, col);
            if (this._widthsResolved) {
              const w = this._colWidths.splice(fromIdx, 1)[0];
              this._colWidths.splice(toIdx, 0, w);
            }
            this._rebuildCells();
            if (this._widthsResolved) this._applyWidths();
            this._emit("fb-column-reorder", {
              fromIndex: fromIdx,
              toIndex: toIdx,
              columns: this._cols.map((c) => c.id)
            });
          }
        } else if (!wasDragging) {
          const col = this._cols[fromIdx];
          if (col && col.sortable !== false && !col.fixed) {
            if (this._sortCol === col.id) {
              this._sortDir = this._sortDir === "asc" ? "desc" : "asc";
            } else {
              this._sortCol = col.id;
              this._sortDir = "asc";
            }
            this.setAttribute("sort-column", this._sortCol);
            this.setAttribute("sort-direction", this._sortDir);
            this._updateSortAttrs();
            this._emit("fb-column-sort", {
              column: this._sortCol,
              direction: this._sortDir
            });
          }
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }
    _updateSortAttrs() {
      this._$$("[part~=cell]").forEach((cell) => {
        const colId = cell.dataset.col;
        if (colId === this._sortCol) {
          cell.setAttribute(
            "aria-sort",
            this._sortDir === "desc" ? "descending" : "ascending"
          );
          const icon = cell.querySelector("[part~=sort-icon]");
          if (icon)
            icon.setAttribute("part", "sort-icon sort-active");
        } else {
          cell.removeAttribute("aria-sort");
          const icon = cell.querySelector("[part~=sort-icon]");
          if (icon) icon.setAttribute("part", "sort-icon");
        }
      });
    }
    disconnectedCallback() {
      if (this._ro) {
        this._ro.disconnect();
        this._ro = null;
      }
      super.disconnectedCallback();
    }
  };

  // src/components/FbSearchBar.ts
  var FbSearchBar = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._debounceTimer = null;
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}</style><div part="container"><input part="input" type="text" /><slot name="icon">\u{1F50D}</slot></div>`;
      this._input = this._$("input");
    }
    _setupEvents() {
      const placeholder = this.getAttribute("placeholder") || "Search library...";
      this._input.placeholder = placeholder;
      this._listen(this._input, "input", () => {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        const query = this._input.value.trim();
        const minLen = parseInt(this.getAttribute("min-length") || "", 10) || 2;
        if (query.length < minLen) return;
        const debounce = parseInt(this.getAttribute("debounce") || "", 10) || 300;
        this._debounceTimer = setTimeout(() => {
          void this._search(query);
        }, debounce);
      });
      this._listen(this._input, "keydown", (e) => {
        const ke = e;
        if (ke.key === "Enter") {
          if (this._debounceTimer) clearTimeout(this._debounceTimer);
          void this._search(this._input.value.trim());
        }
      });
    }
    _subscribe() {
    }
    disconnectedCallback() {
      if (this._debounceTimer) clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
      super.disconnectedCallback();
    }
    async _search(query) {
      if (!query) return;
      this._emit("fb-search", { query });
      try {
        const result = await getFb().library.search(query, 100);
        const tracks = result?.items ?? result?.tracks ?? [];
        this._emit("fb-search-result", {
          tracks,
          count: tracks.length,
          query
        });
      } catch {
        this._emit("fb-search-result", {
          tracks: [],
          count: 0,
          query
        });
      }
    }
  };

  // src/components/FbSeekBar.ts
  var FbSeekBar = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._position = 0;
      this._duration = 0;
      this._isDragging = false;
      /** Drag-only AbortController; recreated per drag, aborted on mouse-up or disconnect. */
      this._dragController = null;
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:flex;align-items:center;width:100%}[part=track]{position:relative;flex:1;cursor:pointer;padding:6px 0}[part=fill]{position:absolute;top:50%;left:0;transform:translateY(-50%);pointer-events:none}[part=thumb]{position:absolute;top:50%;transform:translateY(-50%);pointer-events:none}</style><div part="track" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><div part="fill"></div><div part="thumb"></div></div>`;
      this._track = this._$("[part=track]");
      this._fill = this._$("[part=fill]");
      this._thumb = this._$("[part=thumb]");
    }
    _setupEvents() {
      this._listen(this._track, "click", (e) => {
        if (this._isDragging) return;
        this._seekToEvent(e);
      });
      this._listen(this._track, "mousedown", (e) => {
        e.preventDefault();
        this._isDragging = true;
        this._dragController = new AbortController();
        const signal = this._dragController.signal;
        document.addEventListener(
          "mousemove",
          (ev) => {
            const me = ev;
            const pct = this._calcPercent(me);
            this._position = pct * this._duration;
            this._updateVisual();
            this._emit("fb-seeking", {
              position: this._position
            });
          },
          { signal }
        );
        document.addEventListener(
          "mouseup",
          (ev) => {
            this._isDragging = false;
            if (this._dragController) {
              this._dragController.abort();
              this._dragController = null;
            }
            this._seekToEvent(ev);
          },
          { signal }
        );
      });
      this._listen(this._track, "mousemove", (e) => {
        if (this._isDragging) return;
        const pct = this._calcPercent(e);
        this.style.setProperty("--fb-seek-hover-progress", pct.toString());
      });
      this._listen(this._track, "mouseleave", () => {
        this.style.removeProperty("--fb-seek-hover-progress");
      });
      this._listen(this._track, "keydown", (e) => {
        let delta = 0;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = 5;
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = -5;
        else if (e.key === "Home") {
          e.preventDefault();
          void this._seekTo(0);
          return;
        } else if (e.key === "End") {
          e.preventDefault();
          void this._seekTo(this._duration);
          return;
        } else {
          return;
        }
        e.preventDefault();
        void this._seekTo(
          Math.max(0, Math.min(this._duration, this._position + delta))
        );
      });
    }
    _subscribe() {
      const fb = getFb();
      this._sub("playback:time", (data) => {
        if (!this._isDragging) {
          this._position = data?.position || 0;
          this._updateVisual();
        }
      });
      this._sub("playback:trackChanged", (data) => {
        if (data && data.duration !== void 0) {
          this._duration = data.duration;
        } else {
          fb.player.getCurrentTrack().then((t) => {
            if (t) this._duration = t.duration || 0;
          }).catch(() => {
          });
        }
        this._position = 0;
        this._updateVisual();
      });
      this._sub("playback:seeked", (data) => {
        this._position = data?.position || 0;
        this._updateVisual();
      });
      fb.player.getCurrentTrack().then((t) => {
        if (t) this._duration = t.duration || 0;
      }).then(() => fb.player.getPosition()).then((r) => {
        this._position = r?.position || 0;
        this._updateVisual();
      }).catch(() => {
      });
    }
    disconnectedCallback() {
      if (this._dragController) {
        this._dragController.abort();
        this._dragController = null;
      }
      super.disconnectedCallback();
    }
    /** Mouse X relative to the track, clamped to 0-1. */
    _calcPercent(e) {
      const rect = this._track.getBoundingClientRect();
      return Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width)
      );
    }
    _seekToEvent(e) {
      const pct = this._calcPercent(e);
      void this._seekTo(pct * this._duration);
    }
    async _seekTo(seconds) {
      this._position = seconds;
      this._updateVisual();
      try {
        await getFb().player.seek(seconds);
        this._emit("fb-seek", { position: seconds });
      } catch {
      }
    }
    /**
     * R7: only `style` and host attribute writes — never DOM
     * structural mutations from the high-frequency `playback:time`
     * callback path.
     */
    _updateVisual() {
      const progress = this._duration > 0 ? this._position / this._duration : 0;
      const pct = (progress * 100).toFixed(2) + "%";
      this._fill.style.width = pct;
      this._thumb.style.left = pct;
      this.style.setProperty("--fb-seek-progress", progress.toString());
      this.setAttribute("position", Math.floor(this._position).toString());
      this.setAttribute("duration", Math.floor(this._duration).toString());
      this.setAttribute("progress", progress.toFixed(4));
      this._track.setAttribute(
        "aria-valuenow",
        Math.floor(this._position).toString()
      );
      this._track.setAttribute(
        "aria-valuemax",
        Math.floor(this._duration).toString()
      );
    }
  };

  // src/components/FbShuffleButton.ts
  var FbShuffleButton = class extends FbBaseElement {
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}</style><button part="button" role="button" tabindex="0" aria-label="Shuffle" aria-pressed="false"><slot>\u{1F500}</slot></button>`;
      this._btn = this._$("button");
    }
    _setupEvents() {
      this._listen(this._btn, "click", () => {
        void this._handleClick();
      });
      this._listen(this._btn, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void this._handleClick();
        }
      });
    }
    async _handleClick() {
      try {
        const fb = getFb();
        const current = await fb.player.getOrder();
        const newOrder = SHUFFLE_ORDERS.has(current.order) ? 0 : 4;
        await fb.player.setOrder(newOrder);
        this._emit("fb-shuffle-toggle", {
          active: newOrder !== 0,
          order: newOrder
        });
      } catch {
      }
    }
    _subscribe() {
      this._sub("playback:orderChanged", (data) => {
        this._update(data?.orderIndex ?? 0);
      });
      getFb().player.getOrder().then((r) => this._update(r.order)).catch(() => {
      });
    }
    _update(order) {
      const active = SHUFFLE_ORDERS.has(order);
      if (active) this.setAttribute("active", "");
      else this.removeAttribute("active");
      this._btn.setAttribute("aria-pressed", active.toString());
    }
  };

  // src/components/FbSpectrumVisualizer.ts
  var FbSpectrumVisualizer = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._spectrum = null;
      this._display = null;
      this._resizeObserver = null;
      this._rafId = 0;
      this._colorTimer = 0;
      this._cachedColor = "#000";
      this._cssW = 0;
      this._cssH = 0;
      this._subscriptionId = "";
      this._riseBase = 0.65;
      this._fallBase = 0.28;
      this._lastFrameTime = 0;
    }
    static get observedAttributes() {
      return ["fall-speed", "rise-speed"];
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}canvas{display:block;width:100%;height:100%}</style><canvas part="canvas"></canvas>`;
      this._canvas = this._$("canvas");
      this._ctx = this._canvas?.getContext("2d") ?? null;
    }
    _setupEvents() {
      if (!this._canvas) return;
      this._resizeObserver = new ResizeObserver(() => this._resizeCanvas());
      this._resizeObserver.observe(this._canvas);
      this._resizeCanvas();
      this._refreshColor();
      this._colorTimer = setInterval(() => this._refreshColor(), 1e3);
    }
    _subscribe() {
      const bands = parseInt(this.getAttribute("bands") || "", 10) || 64;
      const fps = parseInt(this.getAttribute("fps") || "", 10) || 30;
      const mode = this.getAttribute("mode") || "bars";
      let fftSize = parseInt(this.getAttribute("fft-size") || "", 10) || 0;
      if (!fftSize || fftSize < 256) {
        fftSize = Math.max(256, bands * 2);
      }
      fftSize = Math.pow(2, Math.ceil(Math.log2(fftSize)));
      this._subscriptionId = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function" ? globalThis.crypto.randomUUID() : `spectrum_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      getFb().invoke("audio.subscribeSpectrum", {
        subscriptionId: this._subscriptionId,
        fftSize,
        fps,
        bands
      }).catch(() => {
      });
      this._sub("audio:spectrum", (data) => {
        const payload = data;
        const spectrum = Array.isArray(payload) ? payload : payload?.spectrum;
        if (!spectrum) return;
        this._spectrum = spectrum;
        if (mode === "raw") {
          this._emit("fb-spectrum-data", {
            bands: new Float32Array(spectrum)
          });
        }
      });
      if (mode !== "raw") {
        this._startRAF();
      }
    }
    attributeChangedCallback(name, _old, newVal) {
      if (name === "fall-speed") {
        const v = parseFloat(newVal || "");
        if (v > 0 && v < 1) this._fallBase = v;
      }
      if (name === "rise-speed") {
        const v = parseFloat(newVal || "");
        if (v > 0 && v < 1) this._riseBase = v;
      }
    }
    disconnectedCallback() {
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = 0;
      }
      if (this._colorTimer) {
        clearInterval(this._colorTimer);
        this._colorTimer = 0;
      }
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      if (this._subscriptionId) {
        getFb().invoke("audio.unsubscribeSpectrum", {
          subscriptionId: this._subscriptionId
        }).catch(() => {
        });
        this._subscriptionId = "";
      }
      this._spectrum = null;
      this._display = null;
      this._ctx = null;
      this._canvas = null;
      this._lastFrameTime = 0;
      super.disconnectedCallback();
    }
    /** Theme escape-hatch — exposes the underlying 2D context. */
    getContext() {
      return this._ctx;
    }
    _refreshColor() {
      this._cachedColor = getComputedStyle(this).color || "#000";
    }
    _startRAF() {
      if (this._rafId) return;
      this._lastFrameTime = 0;
      const loop = (timestamp) => {
        const shouldContinue = this._smoothAndDraw(timestamp);
        if (!this.isConnected || shouldContinue === false) {
          this._rafId = 0;
          return;
        }
        this._rafId = requestAnimationFrame(loop);
      };
      this._rafId = requestAnimationFrame(loop);
    }
    /**
     * Per-band lerp smoothing (fast rise, slower fall) plus mode draw.
     * Returns `false` when there's nothing to draw so the rAF loop can
     * pause itself; resize / re-attach restarts it.
     */
    _smoothAndDraw(timestamp) {
      if (!this._cssW || !this._cssH) return false;
      if (!this._spectrum) return true;
      let dt = 33.3;
      if (timestamp && this._lastFrameTime) {
        dt = timestamp - this._lastFrameTime;
        if (dt > 200) dt = 33.3;
      }
      this._lastFrameTime = timestamp || 0;
      const dtNorm = dt / 33.3;
      const len = this._spectrum.length;
      if (!this._display || this._display.length !== len) {
        this._display = new Float32Array(len);
      }
      const rise = 1 - Math.pow(1 - this._riseBase, dtNorm);
      const fallDefault = 1 - Math.pow(1 - this._fallBase, dtNorm);
      const fallFast = 1 - Math.pow(1 - Math.min(0.55, this._fallBase * 1.6), dtNorm);
      const bassEnd = Math.floor(len * 0.25);
      for (let i = 0; i < len; i++) {
        const target = this._spectrum[i];
        const current = this._display[i];
        if (target >= current) {
          this._display[i] = current + (target - current) * rise;
        } else {
          const fall = i < bassEnd ? fallFast + (fallDefault - fallFast) * (i / bassEnd) : fallDefault;
          this._display[i] = current + (target - current) * fall;
        }
      }
      const mode = this.getAttribute("mode") || "bars";
      if (mode === "bars") this._drawBars();
      else if (mode === "wave") this._drawWave();
      return true;
    }
    _resizeCanvas() {
      if (!this._canvas || !this._ctx) return;
      const rect = this._canvas.getBoundingClientRect();
      const dpr = parseFloat(this.getAttribute("dpr") || "") || devicePixelRatio;
      this._canvas.width = rect.width * dpr;
      this._canvas.height = rect.height * dpr;
      this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._cssW = rect.width;
      this._cssH = rect.height;
      if (this._cssW && this._cssH && !this._rafId && (this.getAttribute("mode") || "bars") !== "raw") {
        this._startRAF();
      }
    }
    _drawBars() {
      if (!this._ctx) return;
      const data = this._display || this._spectrum;
      if (!data) return;
      const w = this._cssW;
      const h = this._cssH;
      this._ctx.clearRect(0, 0, w, h);
      const barWidth = w / data.length;
      const gap = barWidth > 2 ? 1 : 0;
      const drawWidth = Math.max(0.5, barWidth - gap);
      this._ctx.fillStyle = this._cachedColor;
      for (let i = 0; i < data.length; i++) {
        const barHeight = data[i] * h;
        this._ctx.fillRect(
          i * barWidth,
          h - barHeight,
          drawWidth,
          barHeight
        );
      }
    }
    _drawWave() {
      if (!this._ctx) return;
      const data = this._display || this._spectrum;
      if (!data || data.length < 2) return;
      const w = this._cssW;
      const h = this._cssH;
      this._ctx.clearRect(0, 0, w, h);
      this._ctx.strokeStyle = this._cachedColor;
      this._ctx.lineWidth = 2;
      this._ctx.beginPath();
      const step = w / data.length;
      const getX = (i) => i * step;
      const getY = (i) => h - data[i] * h;
      this._ctx.moveTo(getX(0), getY(0));
      for (let i = 1; i < data.length; i++) {
        const cpx = (getX(i - 1) + getX(i)) / 2;
        const cpy = (getY(i - 1) + getY(i)) / 2;
        this._ctx.quadraticCurveTo(getX(i - 1), getY(i - 1), cpx, cpy);
      }
      this._ctx.lineTo(
        getX(data.length - 1),
        getY(data.length - 1)
      );
      this._ctx.stroke();
    }
  };

  // src/components/FbStopAfterCurrent.ts
  var FbStopAfterCurrent = class extends FbBaseElement {
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}</style><button part="button" role="button" tabindex="0" aria-label="Stop after current" aria-pressed="false"><slot>\u23CF</slot></button>`;
      this._btn = this._$("button");
    }
    _setupEvents() {
      this._listen(this._btn, "click", () => {
        void this._handleClick();
      });
      this._listen(this._btn, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void this._handleClick();
        }
      });
    }
    async _handleClick() {
      try {
        const fb = getFb();
        const current = await fb.player.getStopAfterCurrent();
        const newVal = !current.enabled;
        await fb.player.setStopAfterCurrent(newVal);
        this._emit(
          "fb-stop-after-current-toggle",
          { active: newVal }
        );
      } catch {
      }
    }
    _subscribe() {
      this._sub("playback:stopAfterCurrentChanged", (data) => {
        this._update(!!data?.enabled);
      });
      getFb().player.getStopAfterCurrent().then((r) => this._update(!!r.enabled)).catch(() => {
      });
    }
    _update(active) {
      if (active) this.setAttribute("active", "");
      else this.removeAttribute("active");
      this._btn.setAttribute("aria-pressed", (!!active).toString());
    }
  };

  // src/components/FbStopButton.ts
  var FbStopButton = class extends FbBaseElement {
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}</style><button part="button" role="button" tabindex="0" aria-label="Stop"><slot>\u23F9</slot></button>`;
      this._btn = this._$("button");
    }
    _setupEvents() {
      this._listen(this._btn, "click", () => {
        void this._handleClick();
      });
      this._listen(this._btn, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void this._handleClick();
        }
      });
    }
    async _handleClick() {
      try {
        await getFb().player.stop();
        this._emit("fb-stop", {});
      } catch {
      }
    }
  };

  // src/components/FbTechInfo.ts
  var FbTechInfo = class _FbTechInfo extends FbBaseElement {
    static get observedAttributes() {
      return ["field"];
    }
    attributeChangedCallback() {
      if (!this._domReady) return;
      void this._fetchAndUpdate();
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:inline-block}</style><span part="text"></span>`;
      this._text = this._$("[part=text]");
    }
    _subscribe() {
      this._sub("playback:trackChanged", () => {
        void this._fetchAndUpdate();
      });
      void this._fetchAndUpdate();
    }
    static _formatChannels(n) {
      if (n === 2) return "Stereo";
      if (n === 1) return "Mono";
      return n + "ch";
    }
    async _fetchAndUpdate() {
      const field = this.getAttribute("field") || "all";
      try {
        const track = await getFb().player.getCurrentTrack();
        if (!track) {
          this._text.textContent = "";
          return;
        }
        let value = "";
        if (field === "all") {
          const parts = [];
          if (track.codec) parts.push(String(track.codec));
          if (track.bitrate) parts.push(`${track.bitrate} kbps`);
          if (track.sampleRate)
            parts.push(
              `${(Number(track.sampleRate) / 1e3).toFixed(1)} kHz`
            );
          if (track.channels)
            parts.push(_FbTechInfo._formatChannels(Number(track.channels)));
          value = parts.join(" | ");
        } else {
          const raw = field === "samplerate" ? track.sampleRate : track[field];
          if (field === "samplerate" && raw)
            value = `${(Number(raw) / 1e3).toFixed(1)} kHz`;
          else if (field === "bitrate" && raw) value = `${raw} kbps`;
          else if (field === "channels" && raw)
            value = _FbTechInfo._formatChannels(Number(raw));
          else value = raw != null ? String(raw) : "";
        }
        this._text.textContent = value;
      } catch {
        this._text.textContent = "";
      }
    }
  };

  // src/components/FbTimeCurrent.ts
  var FbTimeCurrent = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._seconds = 0;
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:inline-block;font-variant-numeric:tabular-nums}</style><span part="text">0:00</span>`;
      this._text = this._$("[part=text]");
    }
    _subscribe() {
      this._sub("playback:time", (data) => {
        this._seconds = data?.position || 0;
        this._text.textContent = formatTime(this._seconds);
        this.setAttribute("seconds", Math.floor(this._seconds).toString());
      });
      getFb().player.getPosition().then((r) => {
        this._seconds = r?.position || 0;
        this._text.textContent = formatTime(this._seconds);
        this.setAttribute(
          "seconds",
          Math.floor(this._seconds).toString()
        );
      }).catch(() => {
      });
    }
  };

  // src/components/FbTimeRemaining.ts
  var FbTimeRemaining = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._position = 0;
      this._duration = 0;
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:inline-block;font-variant-numeric:tabular-nums}</style><span part="text">-0:00</span>`;
      this._text = this._$("[part=text]");
    }
    _subscribe() {
      const fb = getFb();
      this._sub("playback:time", (data) => {
        this._position = data?.position || 0;
        this._updateText();
      });
      this._sub("playback:trackChanged", (data) => {
        if (data && data.duration !== void 0) {
          this._duration = data.duration;
        } else {
          fb.player.getCurrentTrack().then((t) => {
            this._duration = t?.duration || 0;
            this._updateText();
          }).catch(() => {
          });
        }
        this._position = 0;
        this._updateText();
      });
      fb.player.getCurrentTrack().then((t) => {
        this._duration = t?.duration || 0;
      }).then(() => fb.player.getPosition()).then((r) => {
        this._position = r?.position || 0;
        this._updateText();
      }).catch(() => {
      });
    }
    _updateText() {
      const remaining = Math.max(0, this._duration - this._position);
      this._text.textContent = "-" + formatTime(remaining);
      this.setAttribute("seconds", Math.floor(remaining).toString());
    }
  };

  // src/components/FbTimeTotal.ts
  var FbTimeTotal = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._seconds = 0;
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:inline-block;font-variant-numeric:tabular-nums}</style><span part="text">0:00</span>`;
      this._text = this._$("[part=text]");
    }
    _subscribe() {
      const fb = getFb();
      this._sub("playback:trackChanged", (data) => {
        if (data && data.duration !== void 0) {
          this._seconds = data.duration;
          this._updateText();
        } else {
          fb.player.getCurrentTrack().then((t) => {
            this._seconds = t?.duration || 0;
            this._updateText();
          }).catch(() => {
          });
        }
      });
      fb.player.getCurrentTrack().then((t) => {
        this._seconds = t?.duration || 0;
        this._updateText();
      }).catch(() => {
      });
    }
    _updateText() {
      this._text.textContent = formatTime(this._seconds);
      this.setAttribute("seconds", Math.floor(this._seconds).toString());
    }
  };

  // src/components/FbTitlebar.ts
  var FbTitlebar = class extends FbBaseElement {
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:flex;align-items:center;-webkit-app-region:drag}::slotted(*){-webkit-app-region:no-drag}</style><slot name="left"></slot><div part="drag-region" style="flex:1;min-height:32px"></div><slot name="right"></slot>`;
      this._dragRegion = this._$("[part=drag-region]");
    }
    _setupEvents() {
      this._listen(this._dragRegion, "mousedown", (e) => {
        if (e.button === 0) {
          try {
            void getFb().ui.startDrag();
          } catch {
          }
        }
      });
      this._listen(this._dragRegion, "dblclick", () => {
        try {
          void getFb().ui.toggleMaximize();
        } catch {
        }
        this._emit("fb-titlebar-dblclick", {});
      });
      this._listen(this._dragRegion, "contextmenu", (e) => {
        e.preventDefault();
        try {
          void getFb().ui.showSystemMenu(e.screenX, e.screenY);
        } catch {
        }
      });
    }
    _subscribe() {
      this._sub(
        "window:stateChanged",
        (data) => this._updateState(data)
      );
      getFb().ui.isMaximized().then(
        (r) => this._updateState({
          isMaximized: !!r?.isMaximized
        })
      ).catch(() => {
      });
    }
    _updateState(data) {
      if (data.isMaximized) this.setAttribute("maximized", "");
      else this.removeAttribute("maximized");
    }
  };

  // src/components/FbTrackText.ts
  var FbTrackText = class extends FbBaseElement {
    static get observedAttributes() {
      return ["field", "tf", "placeholder"];
    }
    attributeChangedCallback() {
      if (!this._domReady) return;
      void this._fetchAndUpdate();
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style><span part="text"></span>`;
      this._text = this._$("[part=text]");
    }
    _subscribe() {
      this._sub("playback:trackChanged", () => {
        void this._fetchAndUpdate();
      });
      this._sub("playback:dynamicInfoTrack", () => {
        void this._fetchAndUpdate();
      });
      void this._fetchAndUpdate();
    }
    async _fetchAndUpdate() {
      const tf = this.getAttribute("tf");
      const field = this.getAttribute("field") || "title";
      const placeholder = this.getAttribute("placeholder") || "";
      const fb = getFb();
      try {
        let value = "";
        if (tf) {
          const result = await fb.utils.formatTitle(tf);
          value = result?.result || "";
        } else {
          const track = await fb.player.getCurrentTrack();
          if (track) {
            const raw = track[field];
            if (raw == null) value = "";
            else if (typeof raw === "number") value = raw.toString();
            else value = String(raw);
          }
        }
        this._text.textContent = value ? String(value) : placeholder;
      } catch {
        this._text.textContent = placeholder;
      }
    }
  };

  // src/components/FbVolumeControl.ts
  var FbVolumeControl = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._volume = 100;
      this._muted = false;
      this._isDragging = false;
      this._dragController = null;
    }
    static get observedAttributes() {
      return ["vertical", "no-icon"];
    }
    /**
     * Re-paint the slider whenever an observed attribute changes.
     *
     * `vertical` flips the layout from row to column-reverse via CSS,
     * which means the fill / thumb elements must swap which axis they
     * write into (`width` ↔ `height`, `left` ↔ `bottom`).
     * `_updateVisual()` already clears the inactive axis, so a single
     * call here is enough to recover from the stale style values left
     * over from the previous orientation.
     *
     * `no-icon` is purely a CSS toggle (`:host([no-icon]) [part=mute-button]`)
     * and does not need a JS update, but invoking `_updateVisual()` is
     * harmless and keeps the callback shape simple.
     */
    attributeChangedCallback() {
      if (!this._domReady) return;
      this._updateVisual();
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{display:inline-flex;align-items:center}:host([vertical]){flex-direction:column-reverse}:host([no-icon]) [part=mute-button]{display:none}[part=track]{position:relative;cursor:pointer;padding:6px 0}[part=fill]{position:absolute;pointer-events:none}:host(:not([vertical])) [part=fill]{top:50%;left:0;transform:translateY(-50%)}:host([vertical]) [part=fill]{bottom:0;left:0;width:100%}[part=thumb]{position:absolute;pointer-events:none}</style><button part="mute-button" role="button" tabindex="0" aria-label="Mute"><slot name="icon">\u{1F50A}</slot></button><div part="track" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><div part="fill"></div><div part="thumb"></div></div>`;
      this._muteBtn = this._$("[part=mute-button]");
      this._trackEl = this._$("[part=track]");
      this._fillEl = this._$("[part=fill]");
      this._thumbEl = this._$("[part=thumb]");
    }
    _setupEvents() {
      this._listen(this._muteBtn, "click", () => {
        void this._toggleMute();
      });
      this._listen(this._muteBtn, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void this._toggleMute();
        }
      });
      this._listen(this._trackEl, "click", (e) => {
        if (this._isDragging) return;
        void this._setVolumeFromEvent(e);
      });
      this._listen(this._trackEl, "mousedown", (e) => {
        e.preventDefault();
        this._isDragging = true;
        this._dragController = new AbortController();
        const signal = this._dragController.signal;
        document.addEventListener(
          "mousemove",
          (ev) => {
            this._volume = this._calcVolume(ev);
            this._updateVisual();
          },
          { signal }
        );
        document.addEventListener(
          "mouseup",
          (ev) => {
            this._isDragging = false;
            if (this._dragController) {
              this._dragController.abort();
              this._dragController = null;
            }
            void this._setVolumeFromEvent(ev);
          },
          { signal }
        );
      });
      this._listen(
        this._trackEl,
        "wheel",
        (e) => {
          e.preventDefault();
          const delta = e.deltaY > 0 ? -5 : 5;
          this._volume = Math.max(0, Math.min(100, this._volume + delta));
          void this._applyVolume();
        },
        { passive: false }
      );
      this._listen(this._trackEl, "keydown", (e) => {
        let delta = 0;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = 5;
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = -5;
        else if (e.key === "Home") {
          e.preventDefault();
          this._volume = 0;
          void this._applyVolume();
          return;
        } else if (e.key === "End") {
          e.preventDefault();
          this._volume = 100;
          void this._applyVolume();
          return;
        } else {
          return;
        }
        e.preventDefault();
        this._volume = Math.max(0, Math.min(100, this._volume + delta));
        void this._applyVolume();
      });
    }
    _subscribe() {
      this._sub("playback:volumeChanged", (data) => {
        this._volume = data?.volume ?? this._volume;
        this._muted = data?.muted ?? this._muted;
        this._updateVisual();
      });
      getFb().player.getVolume().then((r) => {
        const resp = r;
        this._volume = resp?.volume ?? 100;
        this._muted = resp?.muted ?? resp?.isMuted ?? false;
        this._updateVisual();
      }).catch(() => {
      });
    }
    disconnectedCallback() {
      if (this._dragController) {
        this._dragController.abort();
        this._dragController = null;
      }
      super.disconnectedCallback();
    }
    /** Compute the 0-100 volume implied by a mouse event on the track. */
    _calcVolume(e) {
      const rect = this._trackEl.getBoundingClientRect();
      let pct;
      if (this.hasAttribute("vertical")) {
        pct = 1 - (e.clientY - rect.top) / rect.height;
      } else {
        pct = (e.clientX - rect.left) / rect.width;
      }
      return Math.round(Math.max(0, Math.min(1, pct)) * 100);
    }
    async _setVolumeFromEvent(e) {
      this._volume = this._calcVolume(e);
      await this._applyVolume();
    }
    async _applyVolume() {
      this._updateVisual();
      try {
        await getFb().player.setVolume(this._volume);
        this._emit("fb-volume-change", {
          volume: this._volume
        });
      } catch {
      }
    }
    async _toggleMute() {
      try {
        await getFb().player.toggleMute();
        this._emit("fb-mute-toggle", {});
      } catch {
      }
    }
    /** R7: only `style` / attribute writes during high-frequency updates. */
    _updateVisual() {
      const pct = this._volume + "%";
      if (this.hasAttribute("vertical")) {
        this._fillEl.style.height = pct;
        this._thumbEl.style.bottom = pct;
        this._thumbEl.style.left = "";
        this._fillEl.style.width = "";
      } else {
        this._fillEl.style.width = pct;
        this._thumbEl.style.left = pct;
        this._thumbEl.style.bottom = "";
        this._fillEl.style.height = "";
      }
      this.style.setProperty("--fb-volume", (this._volume / 100).toString());
      this.setAttribute("volume", this._volume.toString());
      if (this._muted) this.setAttribute("muted", "");
      else this.removeAttribute("muted");
      this._trackEl.setAttribute("aria-valuenow", this._volume.toString());
    }
  };

  // src/components/FbWaveform.ts
  var FbWaveform = class extends FbBaseElement {
    constructor() {
      super(...arguments);
      this._waveform = null;
      this._duration = 0;
      this._gamma = 1.5;
      this._normalize = "adaptive";
      this._resizeObserver = null;
      this._currentPath = null;
      /**
       * Monotonic counter; every `_loadWaveform()` call captures the current
       * value and bails if a newer load (or a disconnect) has bumped it before
       * the async host call returned. Guards against:
       *  - src / track / cue-index churn while `generateFullWaveform` is in flight
       *  - disconnect after dispatch: late results would otherwise write to a
       *    detached canvas and mutate attributes on an unmounted host.
       */
      this._loadToken = 0;
    }
    static get observedAttributes() {
      return ["gamma", "normalize"];
    }
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}:host{position:relative;display:block}canvas{display:block;width:100%;height:100%}div[part=cursor]{position:absolute;top:0;bottom:0;width:2px;pointer-events:none}</style><canvas part="canvas"></canvas><div part="cursor"></div>`;
      this._canvas = this._$("canvas");
      this._ctx = this._canvas.getContext("2d");
      this._cursor = this._$("[part=cursor]");
      const initial = this.getAttribute("normalize") || "adaptive";
      this._normalize = initial;
    }
    _setupEvents() {
      this._listen(this._canvas, "click", (e) => {
        if (!this._duration) return;
        const me = e;
        const rect = this._canvas.getBoundingClientRect();
        if (!rect.width) return;
        const x = me.clientX - rect.left;
        const progress = x / rect.width;
        const time = progress * this._duration;
        getFb().player.seek(time).catch(() => {
        });
        this._emit("fb-seek", {
          position: time,
          progress
        });
      });
      this._resizeObserver = new ResizeObserver(() => this._resizeCanvas());
      this._resizeObserver.observe(this._canvas);
      this._resizeCanvas();
    }
    _subscribe() {
      if (!this.getAttribute("src")) {
        this._sub("playback:trackChanged", () => {
          void this._loadWaveform();
        });
        this._sub("playback:time", (data) => {
          const position = data?.position ?? 0;
          this._updateCursor(position);
        });
      }
      void this._loadWaveform();
    }
    attributeChangedCallback(name, _old, newVal) {
      if (name === "gamma") {
        const v = parseFloat(newVal || "");
        if (v > 0 && v <= 2) {
          this._gamma = v;
          if (this._waveform) this._drawWaveform();
        }
      }
      if (name === "normalize") {
        const mode = (newVal || "").toLowerCase();
        if (mode === "adaptive" || mode === "gamma" || mode === "histogram") {
          this._normalize = mode;
          if (this._waveform) this._drawWaveform();
        }
      }
    }
    disconnectedCallback() {
      this._loadToken++;
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      super.disconnectedCallback();
    }
    async _loadWaveform() {
      const fb = getFb();
      const token = ++this._loadToken;
      try {
        let path = this.getAttribute("src");
        if (!path) {
          const track = await fb.player.getCurrentTrack();
          if (token !== this._loadToken || !this.isConnected) return;
          if (!track?.path) return;
          path = track.path;
          this._duration = track.duration || 0;
        }
        this._currentPath = path;
        this.setAttribute("status", "pending");
        this._waveform = null;
        const opts = {
          resolution: parseInt(this.getAttribute("resolution") || "", 10) || 200,
          method: this.getAttribute("mode") || "rms"
        };
        const cueIndex = this.getAttribute("cue-index");
        if (cueIndex !== null) opts.cueIndex = parseInt(cueIndex, 10);
        const result = await fb.audio.generateFullWaveform(
          path,
          opts
        );
        if (token !== this._loadToken || !this.isConnected) return;
        if (this._currentPath !== path) return;
        if (result?.success && result.waveform) {
          this._waveform = result.waveform;
          this.setAttribute("status", "ready");
          this._drawWaveform();
        } else {
          this.setAttribute("status", "failed");
        }
      } catch (err) {
        if (token !== this._loadToken || !this.isConnected) return;
        this._waveform = null;
        this.setAttribute("status", "failed");
        const code = err?.error;
        this.setAttribute("error", code || "Unknown error");
      }
    }
    _resizeCanvas() {
      const rect = this._canvas.getBoundingClientRect();
      this._canvas.width = rect.width * devicePixelRatio;
      this._canvas.height = rect.height * devicePixelRatio;
      this._ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      if (this._waveform) this._drawWaveform();
    }
    _drawWaveform() {
      if (!this._waveform) return;
      const w = this._canvas.width / devicePixelRatio;
      const h = this._canvas.height / devicePixelRatio;
      this._ctx.clearRect(0, 0, w, h);
      this._ctx.fillStyle = getComputedStyle(this).color || "#000";
      const barWidth = w / this._waveform.length;
      const gap = barWidth > 3 ? Math.max(1, Math.round(barWidth * 0.25)) : barWidth > 1.5 ? 1 : 0;
      const drawWidth = Math.max(0.5, barWidth - gap);
      let display;
      switch (this._normalize) {
        case "histogram":
          display = this._histogramEqualize(this._waveform);
          break;
        case "gamma":
          display = null;
          break;
        default:
          display = this._adaptiveTransform(this._waveform);
          break;
      }
      const centerY = Math.round(h * 0.72);
      const midGap = Math.max(1, Math.round(h * 0.01));
      const topH = centerY;
      const bottomAvail = h - centerY - midGap;
      const mirrorRatio = 0.22;
      const mirrorAlpha = 0.22;
      for (let i = 0; i < this._waveform.length; i++) {
        const raw = display ? Math.abs(display[i]) : Math.abs(this._waveform[i]);
        const val = this._normalize === "gamma" ? Math.pow(raw, this._gamma) : raw;
        const topBarH = val * topH;
        this._ctx.globalAlpha = 1;
        this._ctx.fillRect(
          i * barWidth,
          centerY - topBarH,
          drawWidth,
          topBarH
        );
        const bottomBarH = Math.min(topBarH * mirrorRatio, bottomAvail);
        this._ctx.globalAlpha = mirrorAlpha;
        this._ctx.fillRect(
          i * barWidth,
          centerY + midGap,
          drawWidth,
          bottomBarH
        );
      }
      this._ctx.globalAlpha = 1;
    }
    /**
     * Adaptive visual transform — single continuous power curve with
     * no clipping. Works in three phases:
     * 1. Median-of-3 filter — kills isolated transient spikes.
     * 2. P98-percentile normalisation — maps the common loudness range
     *    into `[0, 1]` without subtracting a noise floor.
     * 3. Power compression `v^γ` (γ < 1) — boosts quiet detail and
     *    softens loud peaks; a smooth curve with no steps.
     */
    _adaptiveTransform(data) {
      const n = data.length;
      if (n < 3) return data;
      const med = new Array(n);
      med[0] = Math.abs(data[0]);
      med[n - 1] = Math.abs(data[n - 1]);
      for (let i = 1; i < n - 1; i++) {
        const a = Math.abs(data[i - 1]);
        const b = Math.abs(data[i]);
        const c = Math.abs(data[i + 1]);
        med[i] = a > b ? b > c ? b : Math.min(a, c) : a > c ? a : Math.min(b, c);
      }
      const nonSilent = med.filter((v) => v > 0.01).sort((a, b) => a - b);
      if (nonSilent.length < 10) return med;
      const p98 = nonSilent[Math.floor(nonSilent.length * 0.98)];
      if (p98 < 1e-3) return med;
      const gamma = 0.6;
      const scale = 0.85;
      const result = new Array(n);
      for (let i = 0; i < n; i++) {
        if (med[i] <= 0.01) {
          result[i] = 0;
          continue;
        }
        const t = med[i] / p98;
        result[i] = Math.min(1, Math.pow(t, gamma)) * scale;
      }
      return result;
    }
    _histogramEqualize(data) {
      const nonZero = [];
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]);
        if (v > 0) nonZero.push(v);
      }
      if (nonZero.length < 2) return data;
      nonZero.sort((a, b) => a - b);
      const result = new Array(data.length);
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]);
        if (v <= 0) {
          result[i] = 0;
          continue;
        }
        let lo = 0;
        let hi = nonZero.length;
        while (lo < hi) {
          const mid = lo + hi >> 1;
          if (nonZero[mid] < v) lo = mid + 1;
          else hi = mid;
        }
        result[i] = (lo + 0.5) / nonZero.length;
      }
      return result;
    }
    _updateCursor(position) {
      if (!this._duration) return;
      const progress = position / this._duration;
      this._cursor.style.left = `${progress * 100}%`;
      this.setAttribute("progress", progress.toFixed(4));
    }
  };

  // src/components/FbWindowControls.ts
  var FbWindowControls = class extends FbBaseElement {
    _buildDOM() {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `<style>${FbBaseElement.baseCSS}</style><div part="controls"><button part="minimize-button" aria-label="Minimize"><slot name="minimize-icon">\u2014</slot></button><button part="maximize-button" aria-label="Maximize"><slot name="maximize-icon">\u25A1</slot></button><button part="restore-icon" hidden><slot name="restore-icon">\u2750</slot></button><button part="close-button" aria-label="Close"><slot name="close-icon">\u2715</slot></button></div>`;
      this._minBtn = this._$("[part=minimize-button]");
      this._maxBtn = this._$("[part=maximize-button]");
      this._restoreBtn = this._$("[part=restore-icon]");
      this._closeBtn = this._$("[part=close-button]");
    }
    _setupEvents() {
      this._listen(this._minBtn, "click", () => {
        try {
          void getFb().ui.minimize();
        } catch {
        }
        this._emit("fb-window-minimize", {});
      });
      this._listen(this._maxBtn, "click", () => {
        try {
          void getFb().ui.toggleMaximize();
        } catch {
        }
        this._emit("fb-window-maximize", {});
      });
      this._listen(this._restoreBtn, "click", () => {
        try {
          void getFb().ui.toggleMaximize();
        } catch {
        }
        this._emit("fb-window-maximize", {});
      });
      this._listen(this._closeBtn, "click", () => {
        try {
          void getFb().ui.close();
        } catch {
        }
        this._emit("fb-window-close", {});
      });
    }
    _subscribe() {
      this._sub(
        "window:stateChanged",
        (data) => this._update(
          !!data?.isMaximized
        )
      );
      getFb().ui.isMaximized().then(
        (r) => this._update(
          !!r?.isMaximized
        )
      ).catch(() => {
      });
    }
    _update(maximized) {
      this._maxBtn.hidden = maximized;
      this._restoreBtn.hidden = !maximized;
      if (maximized) this.setAttribute("maximized", "");
      else this.removeAttribute("maximized");
    }
  };

  // src/components/register.ts
  var defaultComponents = {
    // A. Playback control
    "fb-play-button": FbPlayButton,
    "fb-stop-button": FbStopButton,
    "fb-prev-button": FbPrevButton,
    "fb-next-button": FbNextButton,
    "fb-shuffle-button": FbShuffleButton,
    "fb-repeat-button": FbRepeatButton,
    "fb-stop-after-current": FbStopAfterCurrent,
    // B. Progress + volume
    "fb-seek-bar": FbSeekBar,
    "fb-volume-control": FbVolumeControl,
    "fb-playback-order": FbPlaybackOrder,
    // C. Track info
    "fb-track-text": FbTrackText,
    "fb-cover-art": FbCoverArt,
    "fb-time-current": FbTimeCurrent,
    "fb-time-total": FbTimeTotal,
    "fb-time-remaining": FbTimeRemaining,
    "fb-tech-info": FbTechInfo,
    // D. Playlist + queue
    "fb-playlist-tabs": FbPlaylistTabs,
    "fb-resizable-header": FbResizableHeader,
    "fb-playlist-view": FbPlaylistView,
    "fb-queue-view": FbQueueView,
    "fb-playlist-selector": FbPlaylistSelector,
    // E. Window management
    "fb-titlebar": FbTitlebar,
    "fb-window-controls": FbWindowControls,
    "fb-popup-panel": FbPopupPanel,
    // G. Audio settings + rating
    "fb-output-selector": FbOutputSelector,
    "fb-dsp-preset-selector": FbDspPresetSelector,
    "fb-replaygain-selector": FbReplaygainSelector,
    "fb-rating": FbRating,
    // F. Lyrics + visualisation
    "fb-lyrics-panel": FbLyricsPanel,
    "fb-spectrum-visualizer": FbSpectrumVisualizer,
    "fb-waveform": FbWaveform,
    // H. Metadata + search + console
    "fb-properties-panel": FbPropertiesPanel,
    "fb-search-bar": FbSearchBar,
    "fb-console": FbConsole,
    // I. Library trees
    "fb-library-tree": FbLibraryTree,
    "fb-library-filesystem-tree": FbLibraryFilesystemTree
  };
  function registerComponents(components = defaultComponents) {
    if (typeof customElements === "undefined") return [];
    const registered = [];
    for (const [tag, ctor] of Object.entries(components)) {
      if (!customElements.get(tag)) {
        customElements.define(tag, ctor);
        registered.push(tag);
      }
    }
    return registered;
  }

  // src/components/iife.ts
  registerComponents();
  var iife_default = registerComponents;

  return iife_default;

})();
//# sourceMappingURL=components.global.js.map
//# sourceMappingURL=components.global.js.map