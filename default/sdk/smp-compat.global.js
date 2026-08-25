var __fbSmpCompat = (function (exports) {
  'use strict';

  // src/smp/cache.ts
  function createInitialCache() {
    return {
      isPlaying: false,
      isPaused: false,
      volumeDb: -100,
      muted: false,
      playbackTime: 0,
      playbackLength: 0,
      playbackOrder: 0,
      stopAfterCurrent: false,
      alwaysOnTop: false,
      cursorFollowPlayback: false,
      playbackFollowCursor: false,
      replaygainMode: 0,
      componentPath: "",
      foobarPath: "",
      profilePath: "",
      currentTrack: null,
      playlists: [],
      activePlaylist: 0,
      playingPlaylist: -1,
      playlistCount: 0,
      version: ""
    };
  }
  function createPlaylistRefresher(fb, cache) {
    let scheduled = false;
    const refresh = async () => {
      try {
        const all = await fb.invoke("playlist.getAll", {});
        if (!Array.isArray(all)) return;
        cache.playlists = all;
        cache.playlistCount = all.length;
        const active = all.find((p) => p && p.isActive);
        const playing = all.find((p) => p && p.isPlaying);
        cache.activePlaylist = typeof active?.index === "number" ? active.index : Math.max(0, all.findIndex((p) => p && p.isActive));
        cache.playingPlaylist = typeof playing?.index === "number" ? playing.index : all.findIndex((p) => p && p.isPlaying);
      } catch (e) {
      }
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(async () => {
        try {
          await refresh();
        } finally {
          scheduled = false;
        }
      }, 0);
    };
    return { refresh, schedule };
  }
  function attachCacheEventSubscriptions(fb, cache, schedulePlaylistRefresh) {
    const unsubs = [];
    unsubs.push(
      fb.on("playback:stateChanged", (d) => {
        const state = d?.state;
        const paused = state === "paused";
        const playing = state === "playing" || paused;
        cache.isPaused = paused;
        cache.isPlaying = playing;
        if (typeof d?.position === "number") cache.playbackTime = d.position;
        if (typeof d?.duration === "number") cache.playbackLength = d.duration;
      })
    );
    unsubs.push(
      fb.on("playback:paused", (d) => {
        const paused = !!d?.paused;
        cache.isPaused = paused;
        cache.isPlaying = paused ? true : cache.isPlaying;
      })
    );
    unsubs.push(
      fb.on("playback:volumeChanged", (d) => {
        if (typeof d?.volumeDb === "number") cache.volumeDb = d.volumeDb;
        if (typeof d?.muted === "boolean") cache.muted = d.muted;
      })
    );
    unsubs.push(
      fb.on("playback:time", (d) => {
        if (typeof d?.position === "number") cache.playbackTime = d.position;
      })
    );
    unsubs.push(
      fb.on("playback:trackChanged", (d) => {
        cache.currentTrack = d ?? null;
        if (typeof d?.duration === "number") cache.playbackLength = d.duration;
        cache.isPlaying = true;
      })
    );
    unsubs.push(
      fb.on("playback:stopped", () => {
        cache.isPlaying = false;
        cache.isPaused = false;
        cache.playbackTime = 0;
        cache.playbackLength = 0;
        cache.currentTrack = null;
      })
    );
    unsubs.push(
      fb.on("playback:orderChanged", (d) => {
        if (typeof d?.orderIndex === "number") {
          cache.playbackOrder = d.orderIndex | 0;
        }
      })
    );
    unsubs.push(
      fb.on("playback:stopAfterCurrentChanged", (d) => {
        cache.stopAfterCurrent = !!d?.enabled;
      })
    );
    unsubs.push(
      fb.on("window:alwaysOnTopChanged", (d) => {
        cache.alwaysOnTop = !!d?.enabled;
      })
    );
    unsubs.push(
      fb.on("playback:cursorFollowChanged", (d) => {
        cache.cursorFollowPlayback = !!d?.enabled;
      })
    );
    unsubs.push(
      fb.on("playback:followCursorChanged", (d) => {
        cache.playbackFollowCursor = !!d?.enabled;
      })
    );
    unsubs.push(
      fb.on("audio:replaygainModeChanged", (d) => {
        if (typeof d?.mode === "number") cache.replaygainMode = d.mode;
      })
    );
    const playlistEvents = [
      "playlist:activated",
      "playlist:created",
      "playlist:removed",
      "playlist:reordered",
      "playlist:renamed",
      "playlist:lockChanged",
      "playlist:itemsAdded",
      "playlist:itemsRemoved",
      "playlist:itemsReordered"
    ];
    for (const evt of playlistEvents) {
      unsubs.push(fb.on(evt, schedulePlaylistRefresh));
    }
    return unsubs;
  }
  async function populateCache(fb, cache, opts = {}) {
    const includePaths = !!opts.includePaths;
    const queries = [
      fb.invoke("playback.getState", {}),
      fb.invoke("playback.getVolume", {}),
      fb.invoke("playback.getPosition", {}),
      fb.invoke("playback.getCurrentTrack", {}),
      fb.invoke("playlist.getAll", {}),
      fb.invoke("playback.getPlaybackOrder", {}),
      fb.invoke("playback.getStopAfterCurrent", {}).catch(() => ({ enabled: false })),
      fb.invoke("window.getState", {}).catch(() => ({ alwaysOnTop: false })),
      fb.invoke("config.getCursorFollowPlayback", {}).catch(() => ({ enabled: false })),
      fb.invoke("config.getPlaybackFollowCursor", {}).catch(() => ({ enabled: false })),
      fb.invoke("config.getReplaygainMode", {}).catch(() => ({ mode: 0 }))
    ];
    if (includePaths) {
      queries.push(
        fb.invoke("misc.getComponentPath", {}).catch(() => ({})),
        fb.invoke("misc.getFoobarPath", {}).catch(() => ({})),
        fb.invoke("misc.getProfilePath", {}).catch(() => ({})),
        fb.invoke("config.getVersionInfo", {}).catch(() => ({}))
      );
    }
    const results = await Promise.all(queries);
    const [
      rawState,
      rawVol,
      rawPos,
      rawTrack,
      rawPlaylists,
      rawOrder,
      rawStopAfter,
      rawWin,
      rawCursorFollow,
      rawPlaybackFollow,
      rawRgMode
    ] = results;
    const state = rawState;
    const vol = rawVol;
    const pos = rawPos;
    const track = rawTrack;
    const playlists = rawPlaylists;
    const order = rawOrder;
    const stopAfter = rawStopAfter;
    const winState = rawWin;
    const cursorFollow = rawCursorFollow;
    const playbackFollow = rawPlaybackFollow;
    const rgMode = rawRgMode;
    if (typeof state?.state === "string") {
      const paused = state.state === "paused";
      cache.isPaused = paused;
      cache.isPlaying = state.state === "playing" || paused;
    }
    if (typeof vol?.volumeDb === "number") cache.volumeDb = vol.volumeDb;
    if (typeof vol?.muted === "boolean") cache.muted = vol.muted;
    if (typeof pos?.position === "number") cache.playbackTime = pos.position;
    if (typeof pos?.duration === "number") cache.playbackLength = pos.duration;
    if (track && track.found === false) {
      cache.currentTrack = null;
    } else if (track && typeof track === "object") {
      cache.currentTrack = track;
      if (typeof track.duration === "number") cache.playbackLength = track.duration;
    }
    if (Array.isArray(playlists)) {
      cache.playlists = playlists;
      cache.playlistCount = playlists.length;
      const active = playlists.find((p) => p && p.isActive);
      const playing = playlists.find((p) => p && p.isPlaying);
      cache.activePlaylist = typeof active?.index === "number" ? active.index : Math.max(0, playlists.findIndex((p) => p && p.isActive));
      cache.playingPlaylist = typeof playing?.index === "number" ? playing.index : playlists.findIndex((p) => p && p.isPlaying);
    }
    if (typeof order?.orderIndex === "number") {
      cache.playbackOrder = order.orderIndex | 0;
    } else if (typeof order?.order === "number") {
      cache.playbackOrder = order.order | 0;
    }
    if (typeof stopAfter?.enabled === "boolean") cache.stopAfterCurrent = stopAfter.enabled;
    if (winState) cache.alwaysOnTop = !!(winState.alwaysOnTop ?? winState.isAlwaysOnTop);
    if (typeof cursorFollow?.enabled === "boolean") cache.cursorFollowPlayback = cursorFollow.enabled;
    if (typeof playbackFollow?.enabled === "boolean") {
      cache.playbackFollowCursor = playbackFollow.enabled;
    }
    if (typeof rgMode?.mode === "number") cache.replaygainMode = rgMode.mode | 0;
    if (includePaths) {
      const [rawComponentPath, rawFoobarPath, rawProfilePath, rawVersionInfo] = results.slice(11);
      const componentPath = rawComponentPath;
      const foobarPath = rawFoobarPath;
      const profilePath = rawProfilePath;
      const versionInfo = rawVersionInfo;
      const compPath = typeof componentPath?.path === "string" ? componentPath.path : typeof componentPath === "string" ? componentPath : "";
      if (typeof compPath === "string") cache.componentPath = compPath;
      const fbPath = typeof foobarPath?.path === "string" ? foobarPath.path : typeof foobarPath === "string" ? foobarPath : "";
      if (typeof fbPath === "string") cache.foobarPath = fbPath;
      const profPath = typeof profilePath?.path === "string" ? profilePath.path : typeof profilePath === "string" ? profilePath : "";
      if (typeof profPath === "string") cache.profilePath = profPath;
      if (versionInfo && typeof versionInfo === "object") {
        cache.version = typeof versionInfo.version === "string" ? versionInfo.version : "";
      }
    }
  }

  // src/smp/handleId.ts
  var HANDLE_TOKEN = "|subsong:";
  function formatHandleId(path, subsong = 0) {
    if (!path) return "";
    const s = Number(subsong) || 0;
    return s > 0 ? `${path}${HANDLE_TOKEN}${s}` : path;
  }
  function parseHandleId(handleId) {
    if (typeof handleId !== "string") {
      return { path: "", subsong: 0, id: "" };
    }
    const pos = handleId.lastIndexOf(HANDLE_TOKEN);
    if (pos === -1) {
      return { path: handleId, subsong: 0, id: handleId };
    }
    const path = handleId.slice(0, pos);
    const subsongStr = handleId.slice(pos + HANDLE_TOKEN.length);
    const subsong = Number.parseInt(subsongStr, 10);
    const sub = Number.isFinite(subsong) ? subsong : 0;
    return { path, subsong: sub, id: formatHandleId(path, sub) };
  }
  function stripSubsongSuffix(pathOrHandleId) {
    return parseHandleId(pathOrHandleId).path;
  }

  // src/smp/types.ts
  var SMP_MENU_FLAGS = {
    disabled: 1 << 0,
    checked: 1 << 1,
    radiochecked: 1 << 2,
    defaulthidden: 1 << 3,
    disclosure: 1 << 4
  };

  // src/smp/utils.ts
  function getInvoke() {
    const smp = globalThis.smp;
    const inv = smp?.invoke;
    return typeof inv === "function" ? inv : null;
  }
  function toHandleId(handle) {
    if (!handle) return "";
    if (typeof handle === "string") return handle;
    const h = handle;
    if (typeof h.HandleId === "string") return h.HandleId;
    if (typeof h.Path === "string") {
      const sub = typeof h.SubSong === "number" ? h.SubSong : 0;
      return formatHandleId(h.Path, sub);
    }
    if (typeof h.absolutePath === "string") return h.absolutePath;
    if (typeof h.path === "string") return h.path;
    return "";
  }
  function normalizeHandleList(handleList) {
    if (!handleList) return [];
    const obj = handleList;
    if (typeof obj.Convert === "function") return obj.Convert();
    if (typeof obj.toArray === "function") return obj.toArray();
    if (Array.isArray(handleList)) return handleList;
    if (typeof obj.length === "number") {
      const result = [];
      for (let i = 0; i < obj.length; i++) result.push(obj[i]);
      return result;
    }
    return [];
  }
  function toHandleIdArray(handleList) {
    return normalizeHandleList(handleList).map(toHandleId).filter(Boolean);
  }
  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  var MENU_FLAGS = SMP_MENU_FLAGS;
  var MENU_ADDRESS_SEPARATOR = "|";
  function splitMenuAddress(value) {
    const at = value.indexOf(MENU_ADDRESS_SEPARATOR);
    if (at < 0) return { command: value };
    return {
      command: value.slice(0, at),
      subGuid: value.slice(at + MENU_ADDRESS_SEPARATOR.length)
    };
  }
  function resolveMenuAddress(item, family) {
    if (family === "contextmenu") {
      return typeof item.commandId === "number" ? item.commandId : null;
    }
    if (typeof item.guid === "string" && item.guid.length > 0) {
      return typeof item.subGuid === "string" && item.subGuid.length > 0 ? `${item.guid}${MENU_ADDRESS_SEPARATOR}${item.subGuid}` : item.guid;
    }
    if (typeof item.path === "string" && item.path.length > 0) return item.path;
    return null;
  }
  function buildMenuItems(items, state) {
    const out = [];
    if (!Array.isArray(items)) return out;
    for (const item of items) {
      if (state.limit !== null && state.nextId >= state.limit) break;
      if (!item || typeof item !== "object") continue;
      const type = item.type ?? "command";
      if (type === "separator") {
        out.push({ type: "separator" });
        continue;
      }
      if (type === "submenu") {
        const children = buildMenuItems(item.children, state);
        if (children.length > 0) {
          out.push({
            label: String(item.label ?? ""),
            submenu: children
          });
        }
        continue;
      }
      const menuId = state.nextId++;
      const flags = Number(item.flags) || 0;
      const checked = typeof item.checked === "boolean" ? item.checked : (flags & (MENU_FLAGS.checked | MENU_FLAGS.radiochecked)) !== 0;
      const enabled = item.stateKnown === false ? true : typeof item.enabled === "boolean" ? item.enabled : (flags & MENU_FLAGS.disabled) === 0;
      out.push({
        id: menuId,
        label: String(item.label ?? ""),
        enabled,
        checked
      });
      const address = resolveMenuAddress(item, state.family ?? "mainmenu");
      if (address !== null) state.idMap.set(menuId, address);
    }
    return out;
  }
  var smpUtils = {
    getInvoke,
    toHandleId,
    normalizeHandleList,
    toHandleIdArray,
    clamp,
    sleep,
    MENU_FLAGS,
    buildMenuItems,
    splitMenuAddress
  };

  // src/smp/classes/ContextMenuManager.ts
  var ContextMenuManager = class {
    constructor() {
      this._mode = "auto";
      this._effectiveMode = "auto";
      this._handles = [];
      this._idMap = /* @__PURE__ */ new Map();
    }
    /** Configure the menu against an explicit handle list. */
    InitContext(handles) {
      this._mode = "handles";
      this._handles = normalizeHandleList(handles).map(toHandleId).filter(Boolean);
    }
    /** Configure the menu against the active playlist (no per-track scope). */
    InitContextPlaylist() {
      this._mode = "playlist";
      this._handles = [];
    }
    /** Configure the menu against the now-playing track. */
    InitNowPlaying() {
      this._mode = "nowPlaying";
      this._handles = [];
    }
    /**
     * Fetch the menu structure from the host and populate `menu.SetItems`
     * (when provided). Allocates ids starting at `base_id` (default 1)
     * and capped to `max_id` slots.
     *
     * @returns Structured menu tree (sub-menus / separators preserved).
     */
    async BuildMenu(menu, base_id, max_id) {
      const inv = getInvoke();
      if (!inv) return [];
      const res = await inv("menu.getContextMenu", {
        mode: this._mode,
        handles: this._handles
      });
      this._effectiveMode = res?.mode ?? this._mode;
      const items = Array.isArray(res?.items) ? res.items : [];
      const baseId = (typeof base_id === "number" ? base_id : 1) | 0;
      const limit = typeof max_id === "number" && max_id > 0 ? baseId + (max_id | 0) : null;
      this._idMap.clear();
      const state = {
        nextId: baseId,
        limit,
        idMap: this._idMap,
        family: "contextmenu"
      };
      const out = buildMenuItems(items, state);
      if (menu && typeof menu.SetItems === "function") {
        try {
          menu.SetItems(out);
        } catch {
        }
      }
      return out;
    }
    /**
     * Dispatch the previously-allocated menu id (or a raw numeric C++
     * command id). Returns `false` when the command cannot be resolved.
     */
    async ExecuteByID(id) {
      const inv = getInvoke();
      if (!inv) return false;
      let cmdId = null;
      if (typeof id === "number") cmdId = this._idMap.get(id) ?? null;
      else if (typeof id === "string" && /^[0-9]+$/.test(id)) {
        cmdId = this._idMap.get(Number(id)) ?? null;
      }
      if (cmdId == null && typeof id === "number") cmdId = id;
      if (cmdId == null) return false;
      const res = await inv("menu.runContextCommandById", {
        id: cmdId,
        mode: this._effectiveMode || this._mode,
        handles: this._handles
      });
      return !!res?.success;
    }
  };

  // src/smp/classes/FbFileInfo.ts
  function _normalizeArray(value) {
    if (Array.isArray(value)) {
      return value.map((v) => v == null ? "" : String(v));
    }
    if (value == null) return [""];
    return [String(value)];
  }
  function _findIndexCaseInsensitive(list, name) {
    if (!name) return -1;
    const target = String(name).toLowerCase();
    for (let i = 0; i < list.length; i++) {
      if (String(list[i]).toLowerCase() === target) return i;
    }
    return -1;
  }
  var FbFileInfo = class {
    constructor(input) {
      this._metaNames = [];
      this._metaValues = [];
      this._infoNames = [];
      this._infoValues = [];
      const src = input ?? {};
      const tags = src.tags ?? src.meta ?? {};
      const info = src.info ?? {};
      if (tags && typeof tags === "object") {
        for (const key of Object.keys(tags)) {
          this._metaNames.push(key);
          this._metaValues.push(_normalizeArray(tags[key]));
        }
      }
      if (info && typeof info === "object") {
        for (const key of Object.keys(info)) {
          this._infoNames.push(key);
          this._infoValues.push(info[key] == null ? "" : String(info[key]));
        }
      }
    }
    /** Number of distinct tag fields. */
    get MetaCount() {
      return this._metaNames.length;
    }
    /** Number of distinct technical-info fields. */
    get InfoCount() {
      return this._infoNames.length;
    }
    /** Case-insensitive tag-name lookup; returns `-1` when absent. */
    MetaFind(name) {
      return _findIndexCaseInsensitive(this._metaNames, name);
    }
    /** Case-insensitive info-name lookup; returns `-1` when absent. */
    InfoFind(name) {
      return _findIndexCaseInsensitive(this._infoNames, name);
    }
    MetaName(index) {
      return this._metaNames[index] || "";
    }
    InfoName(index) {
      return this._infoNames[index] || "";
    }
    /** Number of distinct values stored under `MetaName(index)`. */
    MetaValueCount(index) {
      const values = this._metaValues[index];
      return values ? values.length : 0;
    }
    /** Read the `valueIndex`-th value of meta field `index`. */
    MetaValue(index, valueIndex) {
      const values = this._metaValues[index];
      if (!values || valueIndex == null) return "";
      return values[valueIndex] || "";
    }
    InfoValue(index) {
      return this._infoValues[index] || "";
    }
  };

  // src/smp/classes/FbMetadbHandle.ts
  var FbMetadbHandle = class _FbMetadbHandle {
    constructor(input) {
      this._path = "";
      this._subsong = 0;
      this._trackInfo = null;
      if (input instanceof _FbMetadbHandle) {
        this._path = input._path;
        this._subsong = input._subsong;
        this._trackInfo = input._trackInfo;
        return;
      }
      if (typeof input === "string") {
        const parsed = parseHandleId(input);
        this._path = parsed.path || "";
        this._subsong = parsed.subsong || 0;
        return;
      }
      if (!input || typeof input !== "object") return;
      const obj = input;
      const abs = typeof obj.absolutePath === "string" ? obj.absolutePath : "";
      const rawPath = typeof obj.path === "string" ? obj.path : "";
      const pathLike = abs || rawPath || (typeof obj.Path === "string" ? obj.Path : "");
      if (pathLike) {
        const parsed = parseHandleId(pathLike);
        this._path = parsed.path || "";
        this._subsong = parsed.subsong || 0;
      }
      const s = obj.subsong ?? obj.SubSong ?? obj.subSong;
      if ((this._subsong | 0) === 0 && typeof s === "number" && s > 0) {
        this._subsong = s | 0;
      }
      this._trackInfo = obj;
    }
    /** Filesystem path with no `|subsong:N` suffix. */
    get Path() {
      return this._path || "";
    }
    /** Same as {@link Path}; kept for SMP API parity. */
    get RawPath() {
      return this._path || "";
    }
    /** Sub-song index (`0` for single-stream files). */
    get SubSong() {
      return this._subsong | 0;
    }
    /** Track length in seconds (`0` if unknown). */
    get Length() {
      const d = this._trackInfo?.duration;
      return typeof d === "number" ? d : 0;
    }
    /** File size in bytes (`0` if unknown). */
    get FileSize() {
      const s = this._trackInfo?.fileSize;
      return typeof s === "number" ? s : 0;
    }
    /**
     * Round-trip-stable identifier matching `selection.set` /
     * `selection.get` schemata (path + optional `|subsong:N` suffix).
     */
    get HandleId() {
      return formatHandleId(this.Path, this.SubSong);
    }
    /** Path + sub-song equality check; coerces `other` if necessary. */
    Compare(other) {
      if (!other) return false;
      const o = other instanceof _FbMetadbHandle ? other : new _FbMetadbHandle(other);
      return this.Path === o.Path && this.SubSong === o.SubSong;
    }
    /**
     * Resolve full file info via `metadata.read`. Returns `null` when
     * the path is empty, the bridge is unavailable, or the read fails.
     */
    async GetFileInfo() {
      const inv = getInvoke();
      if (!inv) return null;
      const path = stripSubsongSuffix(this.Path);
      if (!path) return null;
      try {
        const res = await inv("metadata.read", { path });
        if (!res || res.success === false) return null;
        return new FbFileInfo(res);
      } catch {
        return null;
      }
    }
    toString() {
      return this.HandleId;
    }
  };

  // src/smp/classes/FbMetadbHandleList.ts
  function _toHandle(item) {
    return item instanceof FbMetadbHandle ? item : new FbMetadbHandle(item);
  }
  function _buildProxy(target) {
    return new Proxy(target, {
      get(t, prop, receiver) {
        if (prop === "length") {
          return t.Count;
        }
        if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
          return t._items[Number(prop)];
        }
        const val = Reflect.get(t, prop, receiver);
        return typeof val === "function" ? val.bind(t) : val;
      },
      set(t, prop, value) {
        if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
          const idx = Number(prop);
          const items = t._items;
          if (idx < 0 || idx >= items.length) return false;
          items[idx] = _toHandle(value);
          return true;
        }
        t[prop] = value;
        return true;
      },
      has(t, prop) {
        if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
          const idx = Number(prop);
          const items = t._items;
          return idx >= 0 && idx < items.length;
        }
        return prop in t;
      }
    });
  }
  var FbMetadbHandleList = class _FbMetadbHandleList {
    constructor(items) {
      this._items = [];
      if (items) this.AddRange(items);
      return _buildProxy(this);
    }
    /** Length getter (SMP-style). */
    get Count() {
      return this._items.length;
    }
    Add(handle) {
      this._items.push(_toHandle(handle));
      return true;
    }
    AddRange(list) {
      if (!list) return false;
      if (list instanceof _FbMetadbHandleList) {
        for (const h of list._items) this._items.push(_toHandle(h));
        return true;
      }
      if (Array.isArray(list)) {
        for (const h of list) this._items.push(_toHandle(h));
        return true;
      }
      const iterable = list;
      if (typeof iterable[Symbol.iterator] === "function") {
        for (const h of iterable) this._items.push(_toHandle(h));
        return true;
      }
      return false;
    }
    /** Shallow copy (handles themselves are shared by reference). */
    Clone() {
      const out = new _FbMetadbHandleList();
      out.AddRange(this._items);
      return out;
    }
    /** Remove the first handle that compares equal; returns `true` on hit. */
    Remove(handle) {
      const idx = this.Find(handle);
      if (idx >= 0) {
        this._items.splice(idx, 1);
        return true;
      }
      return false;
    }
    RemoveAll() {
      this._items.length = 0;
      return true;
    }
    /** Remove by absolute index; returns `false` on out-of-range. */
    RemoveById(index) {
      const idx = index | 0;
      if (idx < 0 || idx >= this._items.length) return false;
      this._items.splice(idx, 1);
      return true;
    }
    /** First-match index by handle equality (path + subsong). */
    Find(handle) {
      const h = _toHandle(handle);
      for (let i = 0; i < this._items.length; i++) {
        if (this._items[i].Compare(h)) return i;
      }
      return -1;
    }
    /** Snapshot copy as a plain array. */
    Convert() {
      return this._items.slice();
    }
    /** Sum of `Length` across all handles (seconds). */
    CalcTotalDuration() {
      let total = 0;
      for (const h of this._items) total += h.Length || 0;
      return total;
    }
    /** Sum of `FileSize` across all handles (bytes). */
    CalcTotalSize() {
      let total = 0;
      for (const h of this._items) total += h.FileSize || 0;
      return total;
    }
    [Symbol.iterator]() {
      return this._items[Symbol.iterator]();
    }
  };

  // src/smp/classes/FbProfiler.ts
  function _now() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }
  var FbProfiler = class {
    constructor(name) {
      this._name = String(name ?? "Profiler");
      this._start = _now();
    }
    /** Elapsed time since construction / last `Reset()` in milliseconds. */
    get Time() {
      return Math.round(_now() - this._start);
    }
    /** Restart the wall-clock baseline. */
    Reset() {
      this._start = _now();
    }
    /** Log the current elapsed time using the configured profiler name. */
    Print() {
      console.log(`[Profiler] ${this._name}: ${this.Time}ms`);
    }
  };

  // src/smp/classes/FbTitleFormat.ts
  function _getPathFromMetadb(handleLike) {
    if (!handleLike) return "";
    if (typeof handleLike === "string") return stripSubsongSuffix(handleLike);
    const h = handleLike;
    if (typeof h.Path === "string") return stripSubsongSuffix(h.Path);
    if (typeof h.absolutePath === "string") return stripSubsongSuffix(h.absolutePath);
    if (typeof h.path === "string") return stripSubsongSuffix(h.path);
    return "";
  }
  function _collectPaths(list) {
    const paths = [];
    if (!list) return paths;
    if (list instanceof FbMetadbHandleList) {
      for (const h of list) {
        const p = _getPathFromMetadb(h);
        if (p) paths.push(p);
      }
      return paths;
    }
    if (Array.isArray(list)) {
      for (const h of list) {
        const p = _getPathFromMetadb(h);
        if (p) paths.push(p);
      }
      return paths;
    }
    const iterable = list;
    if (typeof iterable[Symbol.iterator] === "function") {
      for (const h of iterable) {
        const p = _getPathFromMetadb(h);
        if (p) paths.push(p);
      }
    }
    return paths;
  }
  function _requireInvoke() {
    const inv = getInvoke();
    if (!inv) {
      throw new Error("[SMP] smp.invoke is not available. Load sdk/smp-compat.js first.");
    }
    return inv;
  }
  var FbTitleFormat = class {
    constructor(expression) {
      this._expr = String(expression || "");
    }
    get Expression() {
      return this._expr;
    }
    /**
     * Evaluate against the current now-playing track. Returns the empty
     * string when nothing is playing or the bridge is unavailable.
     */
    async Eval(_force) {
      const cache = globalThis.smp?.cache;
      const path = _getPathFromMetadb(cache?.currentTrack ?? null);
      if (!path) return "";
      const inv = _requireInvoke();
      const res = await inv("titleformat.eval", {
        path,
        pattern: this._expr
      });
      return res && res.success === false ? "" : res?.result ?? "";
    }
    /** Evaluate against a single handle / track-info object. */
    async EvalWithMetadb(handleLike) {
      const path = _getPathFromMetadb(handleLike);
      if (!path) return "";
      const inv = _requireInvoke();
      const res = await inv("titleformat.eval", {
        path,
        pattern: this._expr
      });
      return res && res.success === false ? "" : res?.result ?? "";
    }
    /** Batch evaluate against a list of handles. */
    async EvalWithMetadbs(handleListLike) {
      const paths = _collectPaths(handleListLike);
      if (paths.length === 0) return [];
      const inv = _requireInvoke();
      const res = await inv("titleformat.evalBatch", {
        paths,
        pattern: this._expr
      });
      const results = res?.results;
      if (!Array.isArray(results)) return [];
      return results.map((r) => {
        if (!r || r.success === false) return "";
        return r.result || "";
      });
    }
    toString() {
      return this._expr;
    }
  };

  // src/smp/classes/FbUiSelectionHolder.ts
  var FbUiSelectionHolder = class {
    /**
     * Replace the current UI selection.
     *
     * @param handleList Any value accepted by
     *                   {@link toHandleIdArray} (`FbMetadbHandleList`,
     *                   plain array, etc.).
     * @param type       Selection-type integer (defaults to 0 — generic).
     */
    async SetSelection(handleList, type) {
      const inv = getInvoke();
      if (!inv) return false;
      const handles = toHandleIdArray(handleList);
      const res = await inv("selection.set", {
        handles,
        type: typeof type === "number" ? type : 0
      });
      return !!res?.success;
    }
    /** Track current playlist's *selection* events. */
    async SetPlaylistSelectionTracking() {
      const inv = getInvoke();
      if (!inv) return false;
      const res = await inv("selection.setPlaylistTracking", {
        mode: "selection"
      });
      return !!res?.success;
    }
    /** Track current playlist's *change* events. */
    async SetPlaylistTracking() {
      const inv = getInvoke();
      if (!inv) return false;
      const res = await inv("selection.setPlaylistTracking", {
        mode: "playlist"
      });
      return !!res?.success;
    }
  };

  // src/smp/classes/MainMenuManager.ts
  var MainMenuManager = class {
    constructor() {
      this._root = "";
      this._idMap = /* @__PURE__ */ new Map();
    }
    /** Choose the top-level menu root (e.g. `'File'` / `'Playback'`). */
    Init(root) {
      this._root = String(root || "");
    }
    /** Fetch the main-menu structure under the configured root. */
    async BuildMenu(menu, base_id, max_id) {
      const inv = getInvoke();
      if (!inv) return [];
      const res = await inv("menu.getMainMenu", {
        root: this._root
      });
      const items = Array.isArray(res?.items) ? res.items : [];
      const baseId = (typeof base_id === "number" ? base_id : 1) | 0;
      const limit = typeof max_id === "number" && max_id > 0 ? baseId + (max_id | 0) : null;
      this._idMap.clear();
      const state = {
        nextId: baseId,
        limit,
        idMap: this._idMap,
        family: "mainmenu"
      };
      const out = buildMenuItems(items, state);
      if (menu && typeof menu.SetItems === "function") {
        try {
          menu.SetItems(out);
        } catch {
        }
      }
      return out;
    }
    /**
     * Dispatch the previously-allocated menu id, or a raw command
     * string. Returns `false` if the id cannot be mapped.
     */
    async ExecuteByID(id) {
      const inv = getInvoke();
      if (!inv) return false;
      let mapped = null;
      if (typeof id === "number") mapped = this._idMap.get(id) ?? null;
      else if (/^[0-9]+$/.test(id)) {
        mapped = this._idMap.get(Number(id)) ?? null;
      } else {
        mapped = id;
      }
      if (typeof mapped !== "string" || mapped.length === 0) return false;
      const { command, subGuid } = splitMenuAddress(mapped);
      const res = await inv("menu.runMainMenuCommand", {
        command,
        ...subGuid ? { subGuid } : {}
      });
      return !!res?.success;
    }
  };

  // src/smp/eventMap.ts
  var LOG_PREFIX2 = "[SMP-Compat]";
  function _error(...args) {
    try {
      console.error(LOG_PREFIX2, ...args);
    } catch {
    }
  }
  function _warn(...args) {
    try {
      console.warn(LOG_PREFIX2, ...args);
    } catch {
    }
  }
  var SMP_EVENT_MAP = {
    // Playback
    on_playback_starting: "playback:starting",
    on_playback_new_track: "playback:trackChanged",
    on_playback_stop: "playback:stopped",
    on_playback_seek: "playback:seeked",
    on_playback_pause: "playback:paused",
    on_playback_time: "playback:time",
    on_playback_edited: "playback:edited",
    on_playback_dynamic_info: "playback:dynamicInfo",
    on_playback_dynamic_info_track: "playback:dynamicInfoTrack",
    on_playback_order_changed: "playback:orderChanged",
    on_playback_queue_changed: "playback:queueChanged",
    // Playback stats
    on_item_played: "playback:itemPlayed",
    // Volume
    on_volume_change: "playback:volumeChanged",
    // Selection
    on_selection_changed: "selection:changed",
    // Library
    on_library_items_added: "library:itemsAdded",
    on_library_items_removed: "library:itemsRemoved",
    on_library_items_changed: "library:itemsModified",
    // Metadb
    on_metadb_changed: "metadb:changed",
    // Playlist
    on_playlist_switch: "playlist:activated",
    on_playlist_items_added: "playlist:itemsAdded",
    on_playlist_items_removed: "playlist:itemsRemoved",
    on_playlist_items_reordered: "playlist:itemsReordered",
    on_playlist_items_selection_change: "playlist:selectionChanged",
    on_item_focus_change: "playlist:focusChanged",
    // Audio / DSP
    on_dsp_preset_changed: "audio:dspPresetChanged",
    on_output_device_changed: "audio:outputDeviceChanged",
    on_replaygain_mode_changed: "audio:replaygainModeChanged",
    // UI
    on_colours_changed: "ui:coloursChanged",
    on_font_changed: "ui:fontChanged",
    // App state
    on_always_on_top_changed: "window:alwaysOnTopChanged",
    on_cursor_follow_playback_changed: "playback:cursorFollowChanged",
    on_playback_follow_cursor_changed: "playback:followCursorChanged",
    on_playlist_stop_after_current_changed: "playback:stopAfterCurrentChanged",
    // Special
    on_focus: "__special_focus__",
    on_playlists_changed: "__special_playlists__"
  };
  var PLAYBACK_STOP_REASON = {
    user: 0,
    eof: 1,
    starting_another: 2,
    shutting_down: 3
  };
  var PLAYBACK_STARTING_CMD = {
    play: 1,
    next: 2,
    previous: 3,
    random: 5
  };
  var PLAYBACK_QUEUE_ORIGIN = {
    user_added: 0,
    user_removed: 1,
    playback_advance: 2
  };
  var SMP_PARAM_ADAPTERS = {
    on_playback_new_track: (d) => d,
    on_playback_stop: (d) => {
      const reason = d?.reason;
      return PLAYBACK_STOP_REASON[reason ?? ""] ?? 0;
    },
    on_playback_pause: (d) => !!d?.paused,
    on_playback_time: (d) => {
      const pos = d?.position;
      return typeof pos === "number" ? pos : 0;
    },
    on_playback_seek: (d) => {
      const pos = d?.position;
      return typeof pos === "number" ? pos : 0;
    },
    on_playback_starting: (d) => {
      const command = d?.command;
      const cmd = PLAYBACK_STARTING_CMD[command ?? ""] ?? 0;
      return [cmd, !!d?.paused];
    },
    on_playback_order_changed: (d) => {
      const idx = d?.orderIndex;
      return typeof idx === "number" ? idx : 0;
    },
    on_volume_change: (d) => {
      const v = d?.volumeDb;
      return typeof v === "number" ? v : -100;
    },
    on_selection_changed: () => void 0,
    on_library_items_added: () => void 0,
    on_library_items_removed: () => void 0,
    on_library_items_changed: () => void 0,
    on_metadb_changed: (d) => {
      const data = d;
      const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
      const fromHook = !!data?.fromHook;
      try {
        const list = new FbMetadbHandleList();
        for (const t of tracks) list.Add(t);
        return [list, fromHook];
      } catch {
        return [tracks, fromHook];
      }
    },
    on_item_played: (d) => {
      try {
        return new FbMetadbHandle(d);
      } catch {
        return d;
      }
    },
    on_replaygain_mode_changed: (d) => {
      const m = d?.mode;
      return typeof m === "number" ? m : 0;
    },
    on_dsp_preset_changed: () => void 0,
    on_output_device_changed: () => void 0,
    on_playlist_switch: () => void 0,
    on_playlist_items_added: (d) => {
      const pl = d?.playlist;
      return typeof pl === "number" ? pl : 0;
    },
    on_playlist_items_removed: (d) => {
      const obj = d;
      const pl = typeof obj?.playlist === "number" ? obj.playlist : 0;
      const newCount = typeof obj?.newCount === "number" ? obj.newCount : 0;
      return [pl, newCount];
    },
    on_playlist_items_reordered: (d) => {
      const pl = d?.playlist;
      return typeof pl === "number" ? pl : 0;
    },
    on_playlist_items_selection_change: () => void 0,
    on_item_focus_change: (d) => {
      const obj = d;
      const pl = typeof obj?.playlist === "number" ? obj.playlist : 0;
      const from = typeof obj?.from === "number" ? obj.from : -1;
      const to = typeof obj?.to === "number" ? obj.to : -1;
      return [pl, from, to];
    },
    on_playback_queue_changed: (d) => {
      const origin = d?.origin;
      return PLAYBACK_QUEUE_ORIGIN[origin ?? ""] ?? 0;
    },
    on_always_on_top_changed: (d) => !!d?.enabled,
    on_playlist_stop_after_current_changed: (d) => !!d?.enabled,
    on_cursor_follow_playback_changed: (d) => !!d?.enabled,
    on_playback_follow_cursor_changed: (d) => !!d?.enabled
  };
  function createOnSmp(fb) {
    return (smpEventName, callback) => {
      if (typeof callback !== "function") {
        _warn("fb.onSMP callback must be a function:", smpEventName);
        return () => {
        };
      }
      if (smpEventName === "on_focus") {
        const unsub1 = fb.on("panel:focus", () => {
          try {
            callback(true);
          } catch (e) {
            _error("on_focus handler error:", e);
          }
        });
        const unsub2 = fb.on("panel:blur", () => {
          try {
            callback(false);
          } catch (e) {
            _error("on_focus handler error:", e);
          }
        });
        return () => {
          try {
            unsub1();
          } catch {
          }
          try {
            unsub2();
          } catch {
          }
        };
      }
      if (smpEventName === "on_playlists_changed") {
        const handler = () => {
          try {
            callback();
          } catch (e) {
            _error("on_playlists_changed handler error:", e);
          }
        };
        const events = [
          "playlist:created",
          "playlist:removed",
          "playlist:reordered",
          "playlist:renamed",
          "playlist:lockChanged"
        ];
        const unsubs = events.map((evt) => fb.on(evt, handler));
        return () => {
          for (const u of unsubs) {
            try {
              u();
            } catch {
            }
          }
        };
      }
      const fb2kEvent = SMP_EVENT_MAP[smpEventName];
      if (!fb2kEvent || fb2kEvent.startsWith("__special_")) {
        _warn("Unknown SMP event:", smpEventName);
        return () => {
        };
      }
      const adapter = SMP_PARAM_ADAPTERS[smpEventName];
      const wrapped = (data) => {
        try {
          if (!adapter) {
            callback(data);
            return;
          }
          const adapted = adapter(data);
          if (Array.isArray(adapted)) {
            callback(...adapted);
          } else if (adapted !== void 0) {
            callback(adapted);
          } else {
            callback();
          }
        } catch (e) {
          _error(`Error in ${smpEventName}:`, e);
        }
      };
      const unsub = fb.on(fb2kEvent, wrapped);
      return () => {
        try {
          unsub();
        } catch {
        }
      };
    };
  }

  // src/smp/fbExtensions.ts
  var LOG_PREFIX3 = "[SMP-Compat]";
  function _warn2(...args) {
    try {
      console.warn(LOG_PREFIX3, ...args);
    } catch {
    }
  }
  function _defineIfMissing(target, prop, desc) {
    if (Object.prototype.hasOwnProperty.call(target, prop)) return false;
    Object.defineProperty(target, prop, { configurable: true, ...desc });
    return true;
  }
  function _dbToPercent(db) {
    if (typeof db !== "number" || !Number.isFinite(db)) return 0;
    if (db <= -100) return 0;
    if (db >= 0) return 100;
    const v = 100 * Math.pow(10, db / 20);
    return clamp(v, 0, 100);
  }
  function _toPath(handleLike) {
    if (!handleLike) return "";
    if (typeof handleLike === "string") return stripSubsongSuffix(handleLike);
    const obj = handleLike;
    if (typeof obj.Path === "string") return stripSubsongSuffix(obj.Path);
    if (typeof obj.absolutePath === "string") return stripSubsongSuffix(obj.absolutePath);
    if (typeof obj.path === "string") return stripSubsongSuffix(obj.path);
    return "";
  }
  function attachFbExtensions(fb, plman, cache, schedulePlaylistRefresh) {
    const _invoke2 = fb.invoke.bind(fb);
    const fbExt = fb;
    function _setVolumeDb(db) {
      const nextDb = clamp(Number(db) || -100, -100, 0);
      const oldDb = cache.volumeDb;
      cache.volumeDb = nextDb;
      return _invoke2("playback.setVolume", {
        volume: _dbToPercent(nextDb)
      }).catch((e) => {
        _warn2("setVolumeDb failed, rolling back:", e);
        cache.volumeDb = oldDb;
        throw e;
      });
    }
    _defineIfMissing(fbExt, "Play", {
      value: () => fb.player?.play ? fb.player.play() : _invoke2("playback.play", {})
    });
    _defineIfMissing(fbExt, "Pause", {
      value: () => fb.player?.pause ? fb.player.pause() : _invoke2("playback.pause", {})
    });
    _defineIfMissing(fbExt, "Stop", {
      value: () => fb.player?.stop ? fb.player.stop() : _invoke2("playback.stop", {})
    });
    _defineIfMissing(fbExt, "Next", {
      value: () => fb.player?.next ? fb.player.next() : _invoke2("playback.next", {})
    });
    _defineIfMissing(fbExt, "Prev", {
      value: () => fb.player?.prev ? fb.player.prev() : _invoke2("playback.previous", {})
    });
    _defineIfMissing(fbExt, "Random", {
      value: () => fb.player?.random ? fb.player.random() : _invoke2("playback.random", {})
    });
    _defineIfMissing(fbExt, "PlayOrPause", {
      value: () => fb.player?.toggle ? fb.player.toggle() : _invoke2("playback.playOrPause", {})
    });
    _defineIfMissing(fbExt, "VolumeUp", {
      value: () => _invoke2("playback.volumeUp", {}).catch(() => _setVolumeDb((cache.volumeDb ?? -100) + 1)).catch((e) => _warn2("VolumeUp failed:", e))
    });
    _defineIfMissing(fbExt, "VolumeDown", {
      value: () => _invoke2("playback.volumeDown", {}).catch(() => _setVolumeDb((cache.volumeDb ?? -100) - 1)).catch((e) => _warn2("VolumeDown failed:", e))
    });
    _defineIfMissing(fbExt, "VolumeMute", {
      value: () => _invoke2("playback.toggleMute", {}).catch(
        () => fb.player?.mute ? fb.player.mute() : _invoke2("playback.mute", {})
      )
    });
    _defineIfMissing(fbExt, "Exit", {
      value: () => _invoke2("misc.exit", {}).catch(
        () => fb.ui?.close ? fb.ui.close() : _invoke2("window.close", {})
      )
    });
    if (!Object.getOwnPropertyDescriptor(fbExt, "IsPlaying")) {
      Object.defineProperty(fbExt, "IsPlaying", {
        configurable: true,
        get: () => !!cache.isPlaying
      });
    }
    if (!Object.getOwnPropertyDescriptor(fbExt, "IsPaused")) {
      Object.defineProperty(fbExt, "IsPaused", {
        configurable: true,
        get: () => !!cache.isPaused
      });
    }
    if (!Object.getOwnPropertyDescriptor(fbExt, "Volume")) {
      Object.defineProperty(fbExt, "Volume", {
        configurable: true,
        get: () => typeof cache.volumeDb === "number" ? cache.volumeDb : -100,
        set: (db) => {
          _setVolumeDb(db).catch((e) => _warn2("set Volume failed:", e));
        }
      });
    }
    if (!Object.getOwnPropertyDescriptor(fbExt, "PlaybackTime")) {
      Object.defineProperty(fbExt, "PlaybackTime", {
        configurable: true,
        get: () => typeof cache.playbackTime === "number" ? cache.playbackTime : 0,
        set: (seconds) => {
          const s = Number(seconds) || 0;
          const oldValue = cache.playbackTime;
          cache.playbackTime = s;
          const seek = fb.player?.seek ? fb.player.seek(s) : _invoke2("playback.setPosition", { seconds: s });
          Promise.resolve(seek).catch((e) => {
            _warn2("set PlaybackTime failed, rolling back:", e);
            cache.playbackTime = oldValue;
          });
        }
      });
    }
    if (!Object.getOwnPropertyDescriptor(fbExt, "PlaybackLength")) {
      Object.defineProperty(fbExt, "PlaybackLength", {
        configurable: true,
        get: () => typeof cache.playbackLength === "number" ? cache.playbackLength : 0
      });
    }
    if (!Object.getOwnPropertyDescriptor(fbExt, "StopAfterCurrent")) {
      Object.defineProperty(fbExt, "StopAfterCurrent", {
        configurable: true,
        get: () => !!cache.stopAfterCurrent,
        set: (enabled) => {
          const v = !!enabled;
          const oldValue = cache.stopAfterCurrent;
          cache.stopAfterCurrent = v;
          const p = fb.player?.setStopAfterCurrent ? fb.player.setStopAfterCurrent(v) : _invoke2("playback.setStopAfterCurrent", { enabled: v });
          Promise.resolve(p).catch((e) => {
            _warn2("set StopAfterCurrent failed, rolling back:", e);
            cache.stopAfterCurrent = oldValue;
          });
        }
      });
    }
    if (!Object.getOwnPropertyDescriptor(fbExt, "AlwaysOnTop")) {
      Object.defineProperty(fbExt, "AlwaysOnTop", {
        configurable: true,
        get: () => !!cache.alwaysOnTop,
        set: (enabled) => {
          const v = !!enabled;
          const oldValue = cache.alwaysOnTop;
          cache.alwaysOnTop = v;
          const p = fb.ui?.setAlwaysOnTop ? fb.ui.setAlwaysOnTop(v) : _invoke2("window.setAlwaysOnTop", { enabled: v });
          Promise.resolve(p).catch((e) => {
            _warn2("set AlwaysOnTop failed, rolling back:", e);
            cache.alwaysOnTop = oldValue;
          });
        }
      });
    }
    _defineIfMissing(fbExt, "TitleFormat", {
      value: (expression) => new FbTitleFormat(expression)
    });
    _defineIfMissing(fbExt, "CreateHandleList", {
      value: () => new FbMetadbHandleList()
    });
    _defineIfMissing(fbExt, "CreateProfiler", {
      value: (name) => new FbProfiler(name)
    });
    _defineIfMissing(fbExt, "GetSelection", {
      value: async () => {
        const res = await _invoke2("selection.get", { limit: 0 });
        const handles = Array.isArray(res?.handles) ? res.handles : [];
        const list = new FbMetadbHandleList();
        for (const h of handles) {
          list.Add(new FbMetadbHandle(h));
        }
        return list;
      }
    });
    _defineIfMissing(fbExt, "GetSelectionType", {
      value: async () => {
        const res = await _invoke2("selection.getType", {});
        return typeof res?.type === "number" ? res.type : 0;
      }
    });
    _defineIfMissing(fbExt, "IsLibraryEnabled", {
      value: async () => {
        const res = await _invoke2("library.getStatus", {});
        return !!(res?.enabled ?? res?.initialized);
      }
    });
    _defineIfMissing(fbExt, "IsMetadbInMediaLibrary", {
      value: async (handleLike) => {
        const path = _toPath(handleLike);
        if (!path) return false;
        const res = await _invoke2("library.getByPath", { path });
        return !!res?.found;
      }
    });
    _defineIfMissing(fbExt, "GetLibraryItems", {
      value: async () => {
        const list = new FbMetadbHandleList();
        const chunk = 500;
        let offset = 0;
        let total = null;
        while (total === null || offset < total) {
          const res = await _invoke2("library.getAll", {
            offset,
            limit: chunk
          });
          const tracks = Array.isArray(res?.tracks) ? res.tracks : Array.isArray(res?.items) ? res.items : [];
          if (!Array.isArray(tracks) || tracks.length === 0) break;
          for (const t of tracks) {
            list.Add(new FbMetadbHandle(t));
          }
          if (typeof res?.total === "number") total = res.total;
          offset += tracks.length;
          if (tracks.length < chunk && (total === null || offset >= total)) break;
        }
        return list;
      }
    });
    _defineIfMissing(fbExt, "GetQueryItems", {
      value: async (_handlesLike, query) => {
        const q = String(query ?? "");
        if (!q) return new FbMetadbHandleList();
        const list = new FbMetadbHandleList();
        const chunk = 500;
        let offset = 0;
        let total = null;
        while (total === null || offset < total) {
          const res = await _invoke2("library.search", {
            query: q,
            offset,
            limit: chunk
          });
          const tracks = Array.isArray(res?.tracks) ? res.tracks : Array.isArray(res?.items) ? res.items : [];
          if (!Array.isArray(tracks) || tracks.length === 0) break;
          for (const t of tracks) {
            list.Add(new FbMetadbHandle(t));
          }
          if (typeof res?.total === "number") total = res.total;
          offset += tracks.length;
          if (tracks.length < chunk && (total === null || offset >= total)) break;
        }
        return list;
      }
    });
    _defineIfMissing(fbExt, "GetNowPlaying", {
      value: async () => {
        const res = await _invoke2("playback.getCurrentTrack", {});
        if (res && res.found === false) return null;
        if (!res || typeof res !== "object") return null;
        return new FbMetadbHandle(res);
      }
    });
    _defineIfMissing(fbExt, "GetFocusItem", {
      value: async (_force) => {
        const pl = cache.activePlaylist | 0;
        const focus = await _invoke2("playlist.getFocusedTrack", {
          playlist: pl
        });
        const idx = typeof focus?.index === "number" ? focus.index | 0 : -1;
        if (idx < 0) return null;
        const res = await _invoke2("playlist.getTracks", {
          playlist: pl,
          start: idx,
          count: 1
        });
        const t = Array.isArray(res?.tracks) && res.tracks.length > 0 ? res.tracks[0] : null;
        if (!t) return null;
        return new FbMetadbHandle(t);
      }
    });
    _defineIfMissing(fbExt, "RunMainMenuCommand", {
      value: (command) => _invoke2("menu.runMainMenuCommand", { command: String(command ?? "") })
    });
    _defineIfMissing(fbExt, "RunContextCommand", {
      value: (command) => _invoke2("menu.runContextCommand", { command: String(command ?? "") })
    });
    _defineIfMissing(fbExt, "ShowConsole", {
      value: () => _invoke2("misc.showConsole", {})
    });
    _defineIfMissing(fbExt, "ShowPreferences", {
      value: () => _invoke2("misc.showPreferences", {})
    });
    _defineIfMissing(fbExt, "ShowLibrarySearchUI", {
      value: (query) => _invoke2("misc.showLibrarySearch", { query: String(query ?? "") })
    });
    _defineIfMissing(fbExt, "ShowPopupMessage", {
      value: (msg, title) => _invoke2("misc.showPopupMessage", {
        message: String(msg ?? ""),
        title: String(title ?? "")
      })
    });
    _defineIfMissing(fbExt, "Restart", {
      value: () => _invoke2("misc.restart", {})
    });
    _defineIfMissing(fbExt, "AcquireUiSelectionHolder", {
      value: () => new FbUiSelectionHolder()
    });
    if (!Object.getOwnPropertyDescriptor(fbExt, "ComponentPath")) {
      Object.defineProperty(fbExt, "ComponentPath", {
        configurable: true,
        get: () => String(cache.componentPath || "")
      });
    }
    if (!Object.getOwnPropertyDescriptor(fbExt, "FoobarPath")) {
      Object.defineProperty(fbExt, "FoobarPath", {
        configurable: true,
        get: () => String(cache.foobarPath || "")
      });
    }
    if (!Object.getOwnPropertyDescriptor(fbExt, "ProfilePath")) {
      Object.defineProperty(fbExt, "ProfilePath", {
        configurable: true,
        get: () => String(cache.profilePath || "")
      });
    }
    if (!Object.getOwnPropertyDescriptor(fbExt, "CursorFollowPlayback")) {
      Object.defineProperty(fbExt, "CursorFollowPlayback", {
        configurable: true,
        get: () => !!cache.cursorFollowPlayback,
        set: (enabled) => {
          const v = !!enabled;
          const oldValue = cache.cursorFollowPlayback;
          cache.cursorFollowPlayback = v;
          _invoke2("config.setCursorFollowPlayback", { enabled: v }).catch((e) => {
            _warn2("set CursorFollowPlayback failed, rolling back:", e);
            cache.cursorFollowPlayback = oldValue;
          });
        }
      });
    }
    if (!Object.getOwnPropertyDescriptor(fbExt, "PlaybackFollowCursor")) {
      Object.defineProperty(fbExt, "PlaybackFollowCursor", {
        configurable: true,
        get: () => !!cache.playbackFollowCursor,
        set: (enabled) => {
          const v = !!enabled;
          const oldValue = cache.playbackFollowCursor;
          cache.playbackFollowCursor = v;
          _invoke2("config.setPlaybackFollowCursor", { enabled: v }).catch((e) => {
            _warn2("set PlaybackFollowCursor failed, rolling back:", e);
            cache.playbackFollowCursor = oldValue;
          });
        }
      });
    }
    if (!Object.getOwnPropertyDescriptor(fbExt, "ReplaygainMode")) {
      Object.defineProperty(fbExt, "ReplaygainMode", {
        configurable: true,
        get: () => typeof cache.replaygainMode === "number" ? cache.replaygainMode : 0,
        set: (mode) => {
          const n = Number.isFinite(Number(mode)) ? Number(mode) | 0 : 0;
          const oldValue = cache.replaygainMode;
          cache.replaygainMode = n;
          _invoke2("config.setReplaygainMode", { mode: n }).catch((e) => {
            _warn2("set ReplaygainMode failed, rolling back:", e);
            cache.replaygainMode = oldValue;
          });
        }
      });
    }
    _defineIfMissing(fbExt, "CreateContextMenuManager", {
      value: () => new ContextMenuManager()
    });
    _defineIfMissing(fbExt, "CreateMainMenuManager", {
      value: () => new MainMenuManager()
    });
    _defineIfMissing(fbExt, "CheckClipboardContents", {
      value: async () => {
        const res = await _invoke2("clipboard.read", {});
        return !!res?.hasFiles;
      }
    });
    _defineIfMissing(fbExt, "GetClipboardContents", {
      value: async () => {
        const res = await _invoke2("clipboard.read", {});
        const files = Array.isArray(res?.files) ? res.files : [];
        const list = new FbMetadbHandleList();
        for (const f of files) {
          const id = typeof f === "string" ? f : f?.path ?? "";
          list.Add(new FbMetadbHandle(id));
        }
        return list;
      }
    });
    _defineIfMissing(fbExt, "CopyHandleListToClipboard", {
      value: async (handlesLike) => {
        const items = normalizeHandleList(handlesLike);
        const paths = [];
        for (const h of items) {
          const p = _toPath(h);
          if (p) paths.push(p);
        }
        if (paths.length === 0) return false;
        const res = await _invoke2("clipboard.writeFiles", { paths });
        return !!res?.success;
      }
    });
    _defineIfMissing(fbExt, "GetDSPPresets", {
      value: async () => {
        const res = await _invoke2("config.getDspPresets", {});
        const presets = Array.isArray(res) ? res : [];
        return JSON.stringify(presets);
      }
    });
    _defineIfMissing(fbExt, "SetDSPPreset", {
      value: async (idx) => {
        await _invoke2("config.setActiveDspPreset", { index: idx | 0 });
      }
    });
    _defineIfMissing(fbExt, "GetOutputDevices", {
      value: async () => {
        const res = await _invoke2("config.getOutputDevices", {});
        const devices = Array.isArray(res) ? res : Array.isArray(res?.devices) ? res.devices : [];
        return JSON.stringify(devices);
      }
    });
    _defineIfMissing(fbExt, "SetOutputDevice", {
      value: async (guid, deviceId) => {
        await _invoke2("config.setOutputDevice", {
          outputId: String(guid ?? ""),
          deviceId: String(deviceId ?? "")
        });
      }
    });
    if (!Object.getOwnPropertyDescriptor(fbExt, "Version")) {
      Object.defineProperty(fbExt, "Version", {
        configurable: true,
        get: () => String(cache.version || "")
      });
    }
    _defineIfMissing(fbExt, "RunContextCommandWithMetadb", {
      value: async (command, handleLike, _flags) => {
        const res = await _invoke2("menu.runContextCommand", {
          command: String(command ?? ""),
          handles: handleLike ? [_toPath(handleLike)] : []
        });
        return !!res?.success;
      }
    });
    _defineIfMissing(fbExt, "ClearPlaylist", {
      value: async () => {
        const pl = cache.activePlaylist | 0;
        const res = await _invoke2("playlist.clear", { playlist: pl });
        schedulePlaylistRefresh();
        return !!res?.success;
      }
    });
    _defineIfMissing(fbExt, "GetLibraryRelativePath", {
      value: (handleLike) => {
        const p = _toPath(handleLike);
        const fbPath = cache.foobarPath || "";
        if (!p || !fbPath) return p;
        const norm = (s) => s.replace(/\//g, "\\").replace(/\\+$/, "");
        const np = norm(p);
        const nfb = norm(fbPath);
        if (np.toLowerCase().startsWith(nfb.toLowerCase())) {
          return np.slice(nfb.length).replace(/^\\/, "");
        }
        return p;
      }
    });
  }

  // src/smp/plman.ts
  var LOG_PREFIX4 = "[SMP-Compat]";
  function _warn3(...args) {
    try {
      console.warn(LOG_PREFIX4, ...args);
    } catch {
    }
  }
  function _toIndexArray(listLike) {
    if (!listLike) return [];
    if (Array.isArray(listLike)) {
      return listLike.map((n) => Number(n) | 0).filter((n) => Number.isFinite(n) && n >= 0);
    }
    const iterable = listLike;
    if (typeof iterable[Symbol.iterator] === "function") {
      const out = [];
      for (const v of iterable) {
        const n = Number(v) | 0;
        if (Number.isFinite(n) && n >= 0) out.push(n);
      }
      return out;
    }
    return [];
  }
  function buildPlman(fb, cache, schedulePlaylistRefresh) {
    const _invoke2 = fb.invoke.bind(fb);
    const plman = {};
    Object.defineProperties(plman, {
      ActivePlaylist: {
        configurable: true,
        get: () => cache.activePlaylist | 0,
        set: (idx) => {
          const n = idx | 0;
          const oldValue = cache.activePlaylist;
          cache.activePlaylist = n;
          _invoke2("playlist.setActive", { playlist: n }).catch((e) => {
            _warn3("plman.ActivePlaylist set failed, rolling back cache:", e);
            cache.activePlaylist = oldValue;
            schedulePlaylistRefresh();
          });
        }
      },
      PlayingPlaylist: {
        configurable: true,
        get: () => cache.playingPlaylist | 0
      },
      PlaylistCount: {
        configurable: true,
        get: () => cache.playlistCount | 0
      },
      PlaybackOrder: {
        configurable: true,
        get: () => cache.playbackOrder | 0,
        set: (order) => {
          const n = order | 0;
          const oldValue = cache.playbackOrder;
          cache.playbackOrder = n;
          _invoke2("playback.setPlaybackOrder", { order: n }).catch((e) => {
            _warn3("plman.PlaybackOrder set failed, rolling back cache:", e);
            cache.playbackOrder = oldValue;
          });
        }
      }
    });
    plman.GetPlaylistName = (playlistIdx) => {
      const idx = playlistIdx | 0;
      const all = Array.isArray(cache.playlists) ? cache.playlists : [];
      const p = all.find((x) => (Number(x?.index) | 0) === idx);
      return typeof p?.name === "string" ? p.name : "";
    };
    plman.PlaylistItemCount = (playlistIdx) => {
      const idx = playlistIdx | 0;
      const all = Array.isArray(cache.playlists) ? cache.playlists : [];
      const p = all.find((x) => (Number(x?.index) | 0) === idx);
      return typeof p?.trackCount === "number" ? p.trackCount | 0 : 0;
    };
    plman.FindPlaylist = (name) => {
      const n = String(name ?? "");
      const all = Array.isArray(cache.playlists) ? cache.playlists : [];
      const exact = all.find(
        (p) => p && typeof p.name === "string" && p.name === n
      );
      if (exact && typeof exact.index === "number") return exact.index | 0;
      const lower = n.toLowerCase();
      const ci = all.find(
        (p) => p && typeof p.name === "string" && p.name.toLowerCase() === lower
      );
      return typeof ci?.index === "number" ? ci.index | 0 : -1;
    };
    plman.IsAutoPlaylist = (playlistIdx) => {
      const idx = playlistIdx | 0;
      const all = Array.isArray(cache.playlists) ? cache.playlists : [];
      const p = all.find((x) => (Number(x?.index) | 0) === idx);
      return !!p?.isAutoplaylist;
    };
    plman.IsPlaylistLocked = (playlistIdx) => {
      const idx = playlistIdx | 0;
      const all = Array.isArray(cache.playlists) ? cache.playlists : [];
      const p = all.find((x) => (Number(x?.index) | 0) === idx);
      return !!p?.isLocked;
    };
    plman.CreateAutoPlaylist = async (_playlistIdx, name, query, sort, flags) => {
      const keepSorted = !!((flags ?? 0) & 1);
      const res = await _invoke2("playlist.createAutoplaylist", {
        name: String(name ?? "New Autoplaylist"),
        query: String(query ?? ""),
        sort: String(sort ?? ""),
        keepSorted
      });
      schedulePlaylistRefresh();
      return typeof res?.index === "number" ? res.index | 0 : -1;
    };
    plman.RenamePlaylist = async (playlistIdx, name) => {
      const idx = playlistIdx | 0;
      const res = await _invoke2("playlist.rename", {
        playlist: idx,
        name: String(name ?? "")
      });
      schedulePlaylistRefresh();
      return !!res?.success;
    };
    plman.CreatePlaylist = async (position, name) => {
      const pos = position | 0;
      const params = {
        name: String(name ?? "New Playlist")
      };
      if (pos >= 0) params.position = pos;
      const res = await _invoke2("playlist.create", params);
      schedulePlaylistRefresh();
      return typeof res?.index === "number" ? res.index | 0 : -1;
    };
    plman.RemovePlaylist = async (playlistIdx) => {
      const idx = playlistIdx | 0;
      const res = await _invoke2("playlist.remove", {
        playlist: idx
      });
      schedulePlaylistRefresh();
      return !!res?.success;
    };
    plman.ClearPlaylist = async (playlistIdx) => {
      const idx = playlistIdx | 0;
      const res = await _invoke2("playlist.clear", {
        playlist: idx
      });
      schedulePlaylistRefresh();
      return !!res?.success;
    };
    plman.GetPlaylistFocusItemIndex = async (playlistIdx) => {
      const idx = playlistIdx | 0;
      const res = await _invoke2("playlist.getFocusedTrack", {
        playlist: idx
      });
      return typeof res?.index === "number" ? res.index | 0 : -1;
    };
    plman.SetPlaylistFocusItem = async (playlistIdx, itemIdx) => {
      const idx = playlistIdx | 0;
      const item = itemIdx | 0;
      const res = await _invoke2("playlist.setFocusedTrack", {
        playlist: idx,
        index: item
      });
      return !!res?.success;
    };
    plman.SetPlaylistSelection = async (playlistIdx, items, state) => {
      const idx = playlistIdx | 0;
      const indices = _toIndexArray(items);
      if (indices.length === 0) return true;
      if (state) {
        const res2 = await _invoke2("playlist.setSelection", {
          playlist: idx,
          indices,
          clearOthers: false
        });
        return !!res2?.success;
      }
      const cur = await _invoke2("playlist.getSelection", { playlist: idx }).catch(
        () => null
      );
      const curItems = Array.isArray(cur?.items) ? cur.items : [];
      const toRemove = new Set(indices);
      const toKeep = curItems.filter((i) => !toRemove.has(i));
      const res = await _invoke2("playlist.setSelection", {
        playlist: idx,
        indices: toKeep,
        clearOthers: true
      });
      return !!res?.success;
    };
    plman.ClearPlaylistSelection = async (playlistIdx) => {
      const idx = playlistIdx | 0;
      const res = await _invoke2("playlist.deselectAll", {
        playlist: idx
      });
      return !!res?.success;
    };
    plman.RemovePlaylistSelection = async (playlistIdx, crop) => {
      const idx = playlistIdx | 0;
      const doCrop = !!crop;
      if (!doCrop) {
        const res = await _invoke2("playlist.removeSelectedTracks", {
          playlist: idx
        });
        schedulePlaylistRefresh();
        return !!res?.success;
      }
      const sel = await _invoke2("playlist.getSelection", { playlist: idx }).catch(
        () => null
      );
      const selected = Array.isArray(sel?.items) ? sel.items : [];
      if (selected.length === 0) {
        const res = await _invoke2("playlist.clear", {
          playlist: idx
        });
        schedulePlaylistRefresh();
        return !!res?.success;
      }
      const cnt = await _invoke2("playlist.getTrackCount", { playlist: idx }).catch(
        () => ({ count: 0 })
      );
      const total = typeof cnt?.count === "number" ? cnt.count | 0 : 0;
      const keep = new Set(selected.map((n) => n | 0));
      const remove = [];
      for (let i = 0; i < total; i++) {
        if (!keep.has(i)) remove.push(i);
      }
      if (remove.length > 0) {
        const res = await _invoke2("playlist.removeTracks", {
          playlist: idx,
          items: remove
        });
        schedulePlaylistRefresh();
        return !!res?.success;
      }
      return true;
    };
    plman.SortByFormat = async (playlistIdx, pattern, selectedOnly) => {
      const idx = playlistIdx | 0;
      const res = await _invoke2("playlist.sort", {
        playlist: idx,
        pattern: String(pattern ?? "%title%"),
        selectedOnly: !!selectedOnly,
        descending: false
      });
      return !!res?.success;
    };
    plman.UndoBackup = (_playlistIdx) => {
      return true;
    };
    plman.MovePlaylistSelection = async (playlistIdx, delta) => {
      const idx = playlistIdx | 0;
      const d = delta | 0;
      const res = await _invoke2("playlist.moveTracks", {
        playlist: idx,
        items: [],
        delta: d
      });
      return !!res?.success;
    };
    plman.DuplicatePlaylist = async (from, name) => {
      const idx = from | 0;
      const params = { playlist: idx };
      const newName = String(name ?? "");
      if (newName) params.name = newName;
      const res = await _invoke2("playlist.duplicate", params);
      schedulePlaylistRefresh();
      return typeof res?.index === "number" ? res.index | 0 : -1;
    };
    plman.AddLocations = async (playlistIdx, locations, select) => {
      const idx = playlistIdx | 0;
      const locs = Array.isArray(locations) ? locations.map((s) => String(s)) : typeof locations?.[Symbol.iterator] === "function" ? Array.from(locations, (s) => String(s)) : [];
      const res = await _invoke2("playlist.addPaths", {
        playlist: idx,
        paths: locs
      });
      schedulePlaylistRefresh();
      const added = typeof res?.addedCount === "number" ? res.addedCount | 0 : 0;
      if (select && added > 0 && typeof res?.countBefore === "number") {
        const start = res.countBefore | 0;
        const indices = [];
        for (let i = 0; i < added; i++) indices.push(start + i);
        await _invoke2("playlist.setSelection", {
          playlist: idx,
          indices,
          clearOthers: true
        }).catch(() => null);
      }
      return added;
    };
    plman.GetPlaylistSelectedItems = async (playlistIdx) => {
      const idx = playlistIdx | 0;
      const res = await _invoke2("playlist.getSelectedTracks", {
        playlist: idx
      });
      const tracks = Array.isArray(res?.tracks) ? res.tracks : [];
      const list = new FbMetadbHandleList();
      for (const t of tracks) {
        list.Add(new FbMetadbHandle(t));
      }
      return list;
    };
    plman.GetPlaylistItems = async (playlistIdx) => {
      const idx = playlistIdx | 0;
      const list = new FbMetadbHandleList();
      const chunk = 500;
      let start = 0;
      let total = null;
      while (total === null || start < total) {
        const res = await _invoke2("playlist.getTracks", {
          playlist: idx,
          start,
          count: chunk
        });
        const tracks = res?.tracks ?? [];
        if (!Array.isArray(tracks) || tracks.length === 0) break;
        for (const t of tracks) {
          list.Add(new FbMetadbHandle(t));
        }
        if (typeof res?.total === "number") total = res.total;
        start += tracks.length;
        if (tracks.length < chunk && (total === null || start >= total)) break;
      }
      return list;
    };
    plman.InsertPlaylistItems = async (playlistIdx, base, handlesLike, select) => {
      const idx = playlistIdx | 0;
      const pos = Math.max(0, base | 0);
      const handles = [];
      const collect = (h) => {
        const id = toHandleId(h);
        if (id) handles.push(id);
      };
      if (Array.isArray(handlesLike)) {
        for (const h of handlesLike) collect(h);
      } else if (handlesLike && typeof handlesLike[Symbol.iterator] === "function") {
        for (const h of handlesLike) collect(h);
      }
      if (handles.length === 0) return 0;
      const res = await _invoke2("playlist.insertTracks", {
        playlist: idx,
        position: pos,
        handles
      });
      schedulePlaylistRefresh();
      const added = typeof res?.addedCount === "number" ? res.addedCount | 0 : 0;
      if (select && added > 0) {
        const start = typeof res?.insertIndex === "number" ? res.insertIndex | 0 : pos;
        const indices = [];
        for (let i = 0; i < added; i++) indices.push(start + i);
        await _invoke2("playlist.setSelection", {
          playlist: idx,
          indices,
          clearOthers: true
        }).catch(() => null);
      }
      return added;
    };
    plman.AddItemToPlaybackQueue = async (handleLike) => {
      const id = toHandleId(handleLike);
      if (!id) return 0;
      const path = id.split("|subsong:")[0];
      const res = await _invoke2("queue.addPaths", {
        paths: [path],
        useQueuePlaylist: true
      });
      return typeof res?.addedCount === "number" ? res.addedCount | 0 : res?.success ? 1 : 0;
    };
    plman.GetPlaybackQueueContents = async () => {
      const res = await _invoke2("queue.get", {});
      const items = Array.isArray(res?.items) ? res.items : [];
      return items.map((rawItem) => {
        const it = rawItem;
        return {
          Handle: new FbMetadbHandle(rawItem),
          PlaylistIndex: typeof it?.playlist === "number" ? it.playlist | 0 : -1,
          PlaylistItemIndex: typeof it?.playlistItem === "number" ? it.playlistItem | 0 : -1,
          QueueIndex: typeof it?.queueIndex === "number" ? it.queueIndex | 0 : void 0
        };
      });
    };
    plman.FlushPlaybackQueue = async () => {
      await _invoke2("queue.clear", {});
      return true;
    };
    plman.AddPlaylistItemToPlaybackQueue = async (playlistIdx, playlistItemIdx) => {
      const pl = playlistIdx | 0;
      const item = playlistItemIdx | 0;
      const res = await _invoke2("queue.add", {
        playlist: pl,
        track: item
      });
      return !!res?.success;
    };
    plman.GetPlaybackQueueHandles = async () => {
      const res = await _invoke2("queue.get", {});
      const items = Array.isArray(res?.items) ? res.items : [];
      const list = new FbMetadbHandleList();
      for (const it of items) {
        list.Add(new FbMetadbHandle(it));
      }
      return list;
    };
    plman.IsPlaylistItemSelected = async (playlistIdx, itemIdx) => {
      const pl = playlistIdx | 0;
      const item = itemIdx | 0;
      const res = await _invoke2("playlist.getSelection", {
        playlist: pl
      });
      const selected = Array.isArray(res?.items) ? res.items : [];
      return selected.includes(item);
    };
    plman.FindOrCreatePlaylist = async (name, _unlocked) => {
      const n = String(name ?? "");
      const findFn = plman.FindPlaylist;
      const idx = findFn(n);
      if (idx >= 0) return idx;
      const res = await _invoke2("playlist.create", { name: n });
      schedulePlaylistRefresh();
      return typeof res?.index === "number" ? res.index | 0 : -1;
    };
    plman.MovePlaylist = async (from, to) => {
      const count = cache.playlistCount | 0;
      const f = from | 0;
      const t = to | 0;
      if (f < 0 || f >= count || t < 0 || t >= count || f === t) return false;
      const order = [];
      for (let i = 0; i < count; i++) order.push(i);
      order.splice(f, 1);
      order.splice(t, 0, f);
      const res = await _invoke2("playlist.reorderPlaylists", {
        newOrder: order
      });
      schedulePlaylistRefresh();
      return !!res?.success;
    };
    return plman;
  }

  // src/smp/utilsCompat.ts
  async function _invoke(method, params) {
    const inv = getInvoke();
    if (!inv) {
      throw new Error("[SMP-Utils] smp.invoke not available");
    }
    return await inv(method, params ?? {});
  }
  function FormatDuration(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor(s % 3600 / 60);
    const sec = s % 60;
    const pad = (n) => n < 10 ? "0" + n : String(n);
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }
  function FormatFileSize(bytes) {
    const b = Number(bytes) || 0;
    if (b < 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return i === 0 ? `${v} ${units[i]}` : `${v.toFixed(2)} ${units[i]}`;
  }
  function SplitFilePath(path) {
    const p = String(path ?? "");
    const norm = p.replace(/\//g, "\\");
    const lastSep = norm.lastIndexOf("\\");
    const dir = lastSep >= 0 ? norm.slice(0, lastSep + 1) : "";
    const fullName = lastSep >= 0 ? norm.slice(lastSep + 1) : norm;
    const dotPos = fullName.lastIndexOf(".");
    const fileName = dotPos > 0 ? fullName.slice(0, dotPos) : fullName;
    const ext = dotPos > 0 ? fullName.slice(dotPos) : "";
    return [dir, fileName, ext];
  }
  function PathWildcardMatch(path, pattern) {
    const p = String(path ?? "").toLowerCase();
    const pat = String(pattern ?? "").toLowerCase();
    const escaped = pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    try {
      return new RegExp(`^${escaped}$`).test(p);
    } catch {
      return false;
    }
  }
  function DateStringFromTimestamp(ts) {
    const t = Number(ts) || 0;
    try {
      return new Date(t * 1e3).toLocaleString();
    } catch {
      return "";
    }
  }
  async function FileExists(path) {
    const res = await _invoke("file.exists", {
      path: String(path ?? "")
    });
    return !!res?.exists;
  }
  async function IsFile(path) {
    const res = await _invoke("file.getInfo", {
      path: String(path ?? "")
    });
    return !!res?.isFile;
  }
  async function IsDirectory(path) {
    const res = await _invoke("file.getInfo", {
      path: String(path ?? "")
    });
    return !!res?.isDirectory;
  }
  async function GetFileSize(path) {
    const res = await _invoke("file.getInfo", {
      path: String(path ?? "")
    });
    return typeof res?.size === "number" ? res.size : 0;
  }
  async function ReadTextFile(path, _codepage) {
    const res = await _invoke("file.read", {
      path: String(path ?? "")
    });
    if (typeof res === "string") return res;
    return typeof res?.content === "string" ? res.content : "";
  }
  function ReadUTF8(path) {
    return ReadTextFile(path);
  }
  async function WriteTextFile(path, content, _writeBom) {
    const res = await _invoke("file.write", {
      path: String(path ?? ""),
      content: String(content ?? "")
    });
    return !!res?.success;
  }
  async function Glob(pattern, _excMask, _incMask) {
    const p = String(pattern ?? "");
    const norm = p.replace(/\//g, "\\");
    const lastSep = norm.lastIndexOf("\\");
    const dir = lastSep >= 0 ? norm.slice(0, lastSep) : ".";
    const globPart = lastSep >= 0 ? norm.slice(lastSep + 1) : norm;
    const res = await _invoke("file.list", {
      path: dir,
      recursive: false
    });
    const rawItems = Array.isArray(res?.items) ? res.items : [];
    const prefix = dir.endsWith("\\") ? dir : `${dir}\\`;
    const candidates = rawItems.map((item) => {
      if (typeof item === "string") {
        return item.includes("\\") || item.includes("/") ? item : prefix + item;
      }
      if (typeof item.path === "string") return item.path;
      if (typeof item.name === "string") return prefix + item.name;
      return "";
    }).filter(Boolean);
    return candidates.filter((f) => {
      if (!globPart || globPart === "*" || globPart === "*.*") return true;
      const name = f.split("\\").pop() ?? "";
      return PathWildcardMatch(name, globPart);
    });
  }
  async function ListFiles(folder, recursion) {
    const folderStr = String(folder ?? "");
    const isRecursive = !!recursion;
    const res = await _invoke("file.list", {
      path: folderStr,
      recursive: isRecursive
    });
    const items = Array.isArray(res?.items) ? res.items : [];
    const prefix = !isRecursive && folderStr ? folderStr.endsWith("\\") || folderStr.endsWith("/") ? folderStr : `${folderStr}\\` : "";
    return items.filter((item) => {
      if (typeof item === "object" && item !== null) {
        return !item.isDirectory;
      }
      return true;
    }).map((item) => {
      if (typeof item === "string") {
        if (prefix && !item.includes("\\") && !item.includes("/")) {
          return prefix + item;
        }
        return item;
      }
      return typeof item.path === "string" ? item.path : "";
    }).filter(Boolean);
  }
  async function ListFolders(folder, recursion) {
    const folderStr = String(folder ?? "");
    const isRecursive = !!recursion;
    const res = await _invoke("file.list", {
      path: folderStr,
      recursive: isRecursive
    });
    const dirs = Array.isArray(res?.directories) ? res.directories : [];
    const prefix = !isRecursive && folderStr ? folderStr.endsWith("\\") || folderStr.endsWith("/") ? folderStr : `${folderStr}\\` : "";
    return dirs.map((item) => {
      if (typeof item === "string") {
        if (prefix && !item.includes("\\") && !item.includes("/")) {
          return prefix + item;
        }
        return item;
      }
      return typeof item.path === "string" ? item.path : "";
    }).filter(Boolean);
  }
  async function GetClipboardText() {
    const res = await _invoke("clipboard.read", {});
    return typeof res?.text === "string" ? res.text : "";
  }
  async function SetClipboardText(text) {
    await _invoke("clipboard.write", { text: String(text ?? "") });
  }
  async function CheckComponent(name, isDll) {
    const n = String(name ?? "").toLowerCase();
    if (!n) return false;
    const res = await _invoke("config.getComponents", {});
    const components = Array.isArray(res) ? res : Array.isArray(res?.components) ? res.components : [];
    return components.some((c) => {
      if (!c || typeof c !== "object") return false;
      const cName = String(c.name ?? "").toLowerCase();
      const cFile = String(c.fileName ?? c.filename ?? "").toLowerCase();
      if (isDll) {
        return cFile === n || cFile.endsWith("\\" + n) || cFile.endsWith("/" + n);
      }
      return cName === n || cName.includes(n) || cFile.includes(n);
    });
  }
  async function ReadINI(path, section, key, defaultVal) {
    const def = defaultVal ?? "";
    try {
      const res = await _invoke("file.read", {
        path: String(path ?? "")
      });
      const content = typeof res === "string" ? res : typeof res?.content === "string" ? res.content : "";
      if (!content) return def;
      const sec = String(section ?? "").toLowerCase();
      const k = String(key ?? "").toLowerCase();
      const lines = content.split(/\r?\n/);
      let inSection = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          inSection = trimmed.slice(1, -1).trim().toLowerCase() === sec;
          continue;
        }
        if (inSection && trimmed.includes("=")) {
          const eqPos = trimmed.indexOf("=");
          const lineKey = trimmed.slice(0, eqPos).trim().toLowerCase();
          if (lineKey === k) {
            return trimmed.slice(eqPos + 1).trim();
          }
        }
      }
      return def;
    } catch {
      return def;
    }
  }
  async function WriteINI(path, section, key, val) {
    const filePath = String(path ?? "");
    const sec = String(section ?? "");
    const k = String(key ?? "");
    const v = String(val ?? "");
    try {
      let content = "";
      try {
        const res = await _invoke("file.read", {
          path: filePath
        });
        content = typeof res === "string" ? res : typeof res?.content === "string" ? res.content : "";
      } catch {
      }
      const lines = content ? content.split(/\r?\n/) : [];
      const secHeader = `[${sec}]`;
      let sectionFound = false;
      let keyFound = false;
      let inTargetSection = false;
      let lastSectionLine = -1;
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          if (inTargetSection && !keyFound) {
            lines.splice(i, 0, `${k}=${v}`);
            keyFound = true;
            break;
          }
          inTargetSection = trimmed.toLowerCase() === secHeader.toLowerCase();
          if (inTargetSection) {
            sectionFound = true;
            lastSectionLine = i;
          }
          continue;
        }
        if (inTargetSection && trimmed.includes("=")) {
          const eqPos = trimmed.indexOf("=");
          const lineKey = trimmed.slice(0, eqPos).trim();
          if (lineKey.toLowerCase() === k.toLowerCase()) {
            lines[i] = `${k}=${v}`;
            keyFound = true;
            break;
          }
          lastSectionLine = i;
        }
      }
      if (!sectionFound) {
        if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
          lines.push("");
        }
        lines.push(secHeader);
        lines.push(`${k}=${v}`);
      } else if (!keyFound) {
        lines.splice(lastSectionLine + 1, 0, `${k}=${v}`);
      }
      const newContent = lines.join("\r\n");
      const writeRes = await _invoke("file.write", {
        path: filePath,
        content: newContent
      });
      return !!writeRes?.success;
    } catch {
      return false;
    }
  }
  function InputBox(_windowId, promptText, _caption, defaultVal, errorOnCancel) {
    const def = defaultVal ?? "";
    const result = typeof window !== "undefined" && typeof window.prompt === "function" ? window.prompt(String(promptText ?? ""), String(def)) : null;
    if (result === null) {
      if (errorOnCancel) throw new Error("Dialog cancelled");
      return def;
    }
    return result;
  }
  function ColourPicker(_windowId, defaultColour) {
    return typeof defaultColour === "number" ? defaultColour : 0;
  }
  function CheckFont(name) {
    if (typeof document === "undefined") return false;
    try {
      return document.fonts?.check?.(`12px "${name}"`) ?? false;
    } catch {
      return false;
    }
  }
  var smpUtilsNamespace = {
    get Version() {
      return "1.0.0";
    },
    __smpUtilsCompat: true,
    // Pure JS
    FormatDuration,
    FormatFileSize,
    SplitFilePath,
    PathWildcardMatch,
    DateStringFromTimestamp,
    // Backend
    FileExists,
    IsFile,
    IsDirectory,
    GetFileSize,
    ReadTextFile,
    ReadUTF8,
    WriteTextFile,
    Glob,
    ListFiles,
    ListFolders,
    GetClipboardText,
    SetClipboardText,
    CheckComponent,
    ReadINI,
    WriteINI,
    // WebView2 fallbacks
    InputBox,
    ColourPicker,
    CheckFont
  };

  // src/smp/windowProperties.ts
  var PROP_PREFIX = "smp.prop.";
  function _getNativeFb2k() {
    if (typeof window === "undefined") return null;
    const w = window;
    if (w._nativeFb2k && typeof w._nativeFb2k.invoke === "function") {
      return w._nativeFb2k;
    }
    if (w.fb2k && typeof w.fb2k.invoke === "function") {
      return w.fb2k;
    }
    return null;
  }
  function attachWindowProperties(fb) {
    if (typeof window === "undefined") return;
    const _invoke2 = fb.invoke.bind(fb);
    if (typeof window.GetProperty !== "function") {
      window.GetProperty = async (name, defaultVal) => {
        const key = PROP_PREFIX + String(name ?? "");
        const res = await _invoke2("config.get", {
          key,
          default: defaultVal ?? null
        });
        const value = res?.value;
        if (value !== void 0) return value;
        return defaultVal ?? null;
      };
    }
    if (typeof window.SetProperty !== "function") {
      window.SetProperty = async (name, val) => {
        const key = PROP_PREFIX + String(name ?? "");
        if (val === null || val === void 0) {
          await _invoke2("config.remove", { key });
        } else {
          await _invoke2("config.set", { key, value: val });
        }
      };
    }
    if (typeof window.NotifyOthers !== "function") {
      window.NotifyOthers = (name, info) => {
        const native = _getNativeFb2k();
        if (native) {
          Promise.resolve(
            native.invoke("window.broadcast", {
              message: {
                type: "smp.notifyOthers",
                name: String(name ?? ""),
                info: info ?? null
              }
            })
          ).catch(() => {
          });
        }
      };
    }
  }

  // src/smp/bootstrap.ts
  var LOG_PREFIX5 = "[SMP-Compat]";
  function bootstrapSmpCompat(fb) {
    const cache = createInitialCache();
    const { schedule: schedulePlaylistRefresh} = createPlaylistRefresher(fb, cache);
    const eventUnsubscribers = attachCacheEventSubscriptions(
      fb,
      cache,
      schedulePlaylistRefresh
    );
    const plman = buildPlman(fb, cache, schedulePlaylistRefresh);
    attachFbExtensions(fb, plman, cache, schedulePlaylistRefresh);
    attachWindowProperties(fb);
    const fbExt = fb;
    if (typeof fbExt.onSMP !== "function") {
      Object.defineProperty(fbExt, "onSMP", {
        configurable: true,
        value: createOnSmp(fb)
      });
    }
    const dispose = () => {
      for (const unsub of eventUnsubscribers) {
        try {
          if (typeof unsub === "function") unsub();
        } catch {
        }
      }
      eventUnsubscribers.length = 0;
      try {
        console.log(LOG_PREFIX5, "disposed - all event listeners removed");
      } catch {
      }
    };
    const refreshCache = async () => {
      await populateCache(fb, cache);
      try {
        console.log(LOG_PREFIX5, "cache refreshed (full)");
      } catch {
      }
    };
    const ready = (async () => {
      try {
        await populateCache(fb, cache, { includePaths: true });
      } catch {
      }
      return true;
    })();
    const invoke = (method, params) => fb.invoke(method, params ?? {});
    const smp = {
      ready,
      cache,
      invoke,
      parseHandleId,
      formatHandleId,
      stripSubsongSuffix,
      refreshCache,
      dispose,
      __smpCompatLoaded: true
    };
    const fbWithCache = fb;
    if (!fbWithCache._cache) {
      Object.defineProperty(fbWithCache, "_cache", {
        value: cache,
        enumerable: false,
        configurable: true
      });
    }
    return {
      smp,
      plman,
      smpUtils,
      utils: smpUtilsNamespace,
      classes: {
        FbFileInfo,
        FbMetadbHandle,
        FbMetadbHandleList,
        FbProfiler,
        FbTitleFormat,
        FbUiSelectionHolder,
        ContextMenuManager,
        MainMenuManager
      }
    };
  }
  function installSmpGlobals(result) {
    if (typeof globalThis === "undefined") return;
    const g = globalThis;
    if (g.smp && g.smp.__smpCompatLoaded) {
      return;
    }
    g.smp = result.smp;
    g.plman = result.plman;
    g.smpUtils = result.smpUtils;
    if (!g.utils?.__smpUtilsCompat) {
      g.utils = result.utils;
    }
    for (const [name, ctor] of Object.entries(result.classes)) {
      if (!Object.prototype.hasOwnProperty.call(g, name)) {
        Reflect.set(g, name, ctor);
      }
    }
  }

  // src/smp/iife.ts
  var LOG_PREFIX6 = "[SMP-Compat]";
  (function autoBootstrap() {
    if (typeof globalThis === "undefined") return;
    const g = globalThis;
    const fb = g.fb;
    if (!fb || typeof fb.on !== "function" || typeof fb.invoke !== "function") {
      try {
        console.warn(
          LOG_PREFIX6,
          "Bridge bundle not detected (fb.on / fb.invoke missing); SMP compatibility layer disabled."
        );
      } catch {
      }
      return;
    }
    try {
      const result = bootstrapSmpCompat(fb);
      installSmpGlobals(result);
    } catch (e) {
      try {
        console.error(LOG_PREFIX6, "bootstrap failed:", e);
      } catch {
      }
    }
  })();
  var iife_default = bootstrapSmpCompat;

  exports.bootstrapSmpCompat = bootstrapSmpCompat;
  exports.default = iife_default;
  exports.installSmpGlobals = installSmpGlobals;

  Object.defineProperty(exports, '__esModule', { value: true });

  return exports;

})({});
//# sourceMappingURL=smp-compat.global.js.map
//# sourceMappingURL=smp-compat.global.js.map