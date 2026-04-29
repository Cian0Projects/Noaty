import { marked } from "https://esm.sh/marked@12";

const LS_PASS = "noatyPasscodeHash";
const LS_CFG = "noatyConfig";
const LS_LAST = "noatyLastDocId";
const FILE_PATH = "noaty.json";
const SAVE_DEBOUNCE_MS = 800;
const COOLDOWN_MS = 30_000;
const MAX_ATTEMPTS = 3;

const $ = (id) => document.getElementById(id);

const state = {
  data: { version: 1, tree: [] },
  sha: null,
  currentDocId: null,
  config: null,
  saveTimer: null,
  failedAttempts: 0,
  cooldownUntil: 0,
  editMode: false,
};

// ---------- Crypto / encoding ----------

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64encode(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64decode(s) {
  const bin = atob(s.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------- GitHub Contents API ----------

async function ghFetch(path, opts = {}) {
  const { owner, repo, pat } = state.config;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers || {}),
    },
  });
  return res;
}

async function loadData() {
  setStatus("Loading…");
  const res = await ghFetch(FILE_PATH);
  if (res.status === 404) {
    state.data = { version: 1, tree: [] };
    state.sha = null;
    setStatus("New data file — will be created on first save", "ok");
    return;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Load failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const j = await res.json();
  state.sha = j.sha;
  try {
    const parsed = JSON.parse(b64decode(j.content));
    state.data = { version: 1, tree: [], ...parsed };
    if (!Array.isArray(state.data.tree)) state.data.tree = [];
  } catch {
    setStatus("Existing file is not valid JSON — starting fresh tree (won't overwrite until you save)", "error");
    state.data = { version: 1, tree: [] };
  }
  setStatus("Loaded", "ok");
}

async function saveData() {
  if (!state.config) return;
  const body = {
    message: `Noaty update ${new Date().toISOString()}`,
    content: b64encode(JSON.stringify(state.data, null, 2)),
  };
  if (state.sha) body.sha = state.sha;
  setStatus("Saving…");
  let res;
  try {
    res = await ghFetch(FILE_PATH, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    setStatus(`Network error: ${err.message}`, "error");
    return;
  }
  if (res.status === 409 || res.status === 422) {
    setStatus("Conflict — remote changed. Reload to pull latest before editing further.", "error");
    return;
  }
  if (res.status === 401 || res.status === 403) {
    setStatus("Auth failed — check your PAT in Settings.", "error");
    return;
  }
  if (!res.ok) {
    const text = await res.text();
    setStatus(`Save failed (${res.status}): ${text.slice(0, 120)}`, "error");
    return;
  }
  const j = await res.json();
  state.sha = j.content?.sha || state.sha;
  setStatus(`Saved ${new Date().toLocaleTimeString()}`, "ok");
}

function scheduleSave() {
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveData, SAVE_DEBOUNCE_MS);
}

// ---------- Tree helpers ----------

const uid = () => crypto.randomUUID();

function* walk(nodes, parent = null) {
  for (const n of nodes) {
    yield { node: n, parent, siblings: nodes };
    if (n.type === "folder") yield* walk(n.children || [], n);
  }
}

function findNode(id) {
  for (const e of walk(state.data.tree)) if (e.node.id === id) return e;
  return null;
}

function deleteNode(id) {
  const recurse = (arr) => {
    const i = arr.findIndex((n) => n.id === id);
    if (i >= 0) return arr.splice(i, 1)[0];
    for (const n of arr) {
      if (n.type === "folder") {
        const r = recurse(n.children || []);
        if (r) return r;
      }
    }
    return null;
  };
  return recurse(state.data.tree);
}

function addNode(parentId, node) {
  if (!parentId) {
    state.data.tree.push(node);
    return;
  }
  const e = findNode(parentId);
  if (e && e.node.type === "folder") {
    e.node.children = e.node.children || [];
    e.node.children.push(node);
    e.node.expanded = true;
  } else {
    state.data.tree.push(node);
  }
}

// ---------- Tree rendering ----------

function renderTree() {
  const root = $("tree");
  root.innerHTML = "";
  if (!state.data.tree.length) {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.style.padding = "8px";
    hint.textContent = "No items yet. Use + Folder or + Doc above.";
    root.append(hint);
    return;
  }
  root.append(buildList(state.data.tree));
}

function buildList(nodes) {
  const container = document.createElement("div");
  for (const n of nodes) container.append(buildNode(n));
  return container;
}

function buildNode(node) {
  const wrap = document.createElement("div");
  wrap.className = "tree-node";

  const row = document.createElement("div");
  row.className = "tree-row";
  if (node.id === state.currentDocId) row.classList.add("selected");

  const chev = document.createElement("span");
  chev.className = "chevron";
  chev.textContent = node.type === "folder" ? (node.expanded ? "▾" : "▸") : "";
  row.append(chev);

  const icon = document.createElement("span");
  icon.className = "icon";
  icon.textContent = node.type === "folder" ? "📁" : "📄";
  row.append(icon);

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = node.name;
  row.append(label);

  const actions = document.createElement("span");
  actions.className = "actions";

  if (node.type === "folder") {
    const addF = mkActionBtn("+F", "New folder inside", (e) => {
      e.stopPropagation();
      newFolder(node.id);
    });
    const addD = mkActionBtn("+D", "New doc inside", (e) => {
      e.stopPropagation();
      newDoc(node.id);
    });
    actions.append(addF, addD);
  }
  const renameBtn = mkActionBtn("✎", "Rename", (e) => {
    e.stopPropagation();
    renameNodeUI(node);
  });
  const delBtn = mkActionBtn("✕", "Delete", (e) => {
    e.stopPropagation();
    deleteNodeUI(node);
  });
  actions.append(renameBtn, delBtn);
  row.append(actions);

  row.addEventListener("click", () => {
    if (node.type === "folder") {
      node.expanded = !node.expanded;
      renderTree();
      scheduleSave();
    } else {
      openDoc(node.id);
    }
  });

  wrap.append(row);
  if (node.type === "folder" && node.expanded) {
    const children = document.createElement("div");
    children.className = "tree-children";
    children.append(buildList(node.children || []));
    wrap.append(children);
  }
  return wrap;
}

function mkActionBtn(text, title, onClick) {
  const b = document.createElement("button");
  b.textContent = text;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function renameNodeUI(node) {
  const name = prompt("Rename:", node.name);
  if (!name || !name.trim()) return;
  node.name = name.trim();
  renderTree();
  if (state.currentDocId === node.id) $("doc-title").value = node.name;
  scheduleSave();
}

function deleteNodeUI(node) {
  const msg =
    node.type === "folder"
      ? `Delete folder "${node.name}" and everything inside?`
      : `Delete document "${node.name}"?`;
  if (!confirm(msg)) return;
  deleteNode(node.id);
  if (state.currentDocId && !findNode(state.currentDocId)) {
    state.currentDocId = null;
    showEmpty();
  }
  renderTree();
  scheduleSave();
}

function newFolder(parentId = null) {
  const name = prompt("Folder name:", "New folder");
  if (!name || !name.trim()) return;
  addNode(parentId, {
    id: uid(),
    type: "folder",
    name: name.trim(),
    expanded: true,
    children: [],
  });
  renderTree();
  scheduleSave();
}

function newDoc(parentId = null) {
  const name = prompt("Document name:", "New document");
  if (!name || !name.trim()) return;
  const id = uid();
  addNode(parentId, {
    id,
    type: "doc",
    name: name.trim(),
    content: "",
    updatedAt: new Date().toISOString(),
  });
  renderTree();
  openDoc(id);
  scheduleSave();
}

// ---------- Editor ----------

function openDoc(id) {
  const e = findNode(id);
  if (!e || e.node.type !== "doc") return;
  state.currentDocId = id;
  localStorage.setItem(LS_LAST, id);
  $("empty").classList.add("hidden");
  $("editor").classList.remove("hidden");
  $("doc-title").value = e.node.name;
  $("edit").value = e.node.content || "";
  state.editMode = false;
  $("edit").classList.add("hidden");
  $("view").classList.remove("hidden");
  $("toggle-mode").textContent = "Edit";
  renderView();
  renderTree();
}

function showEmpty() {
  $("empty").classList.remove("hidden");
  $("editor").classList.add("hidden");
}

function currentDoc() {
  return state.currentDocId ? findNode(state.currentDocId)?.node : null;
}

function renderView() {
  const doc = currentDoc();
  if (!doc) return;
  const html = marked.parse(doc.content || "", { gfm: true, breaks: false });
  const view = $("view");
  view.innerHTML = html;

  const checkboxes = view.querySelectorAll('li input[type="checkbox"]');
  let i = 0;
  for (const cb of checkboxes) {
    cb.disabled = false;
    const li = cb.closest("li");
    if (li) {
      li.classList.add("task-line");
      if (cb.checked) li.classList.add("task-done");
    }
    const idx = i++;
    cb.addEventListener("click", (ev) => {
      ev.preventDefault();
      toggleTaskAtIndex(idx);
    });
  }
}

function toggleTaskAtIndex(idx) {
  const doc = currentDoc();
  if (!doc) return;
  let count = 0;
  doc.content = (doc.content || "").replace(
    /^(\s*[-*+]\s+)\[([ xX])\]/gm,
    (match, prefix, mark) => {
      if (count++ === idx) {
        const next = mark === " " ? "x" : " ";
        return `${prefix}[${next}]`;
      }
      return match;
    }
  );
  doc.updatedAt = new Date().toISOString();
  $("edit").value = doc.content;
  renderView();
  scheduleSave();
}

function setupEditor() {
  $("doc-title").addEventListener("input", (e) => {
    const doc = currentDoc();
    if (!doc) return;
    doc.name = e.target.value;
    renderTree();
    scheduleSave();
  });

  $("toggle-mode").addEventListener("click", () => {
    state.editMode = !state.editMode;
    if (state.editMode) {
      $("view").classList.add("hidden");
      $("edit").classList.remove("hidden");
      $("toggle-mode").textContent = "Done";
      $("edit").focus();
    } else {
      const doc = currentDoc();
      if (doc) doc.content = $("edit").value;
      $("edit").classList.add("hidden");
      $("view").classList.remove("hidden");
      $("toggle-mode").textContent = "Edit";
      renderView();
    }
  });

  $("edit").addEventListener("input", () => {
    const doc = currentDoc();
    if (!doc) return;
    doc.content = $("edit").value;
    doc.updatedAt = new Date().toISOString();
    scheduleSave();
  });
}

// ---------- Status bar ----------

function setStatus(text, kind = "") {
  const s = $("status");
  s.textContent = text;
  s.className = "status" + (kind ? " " + kind : "");
}

// ---------- Settings modal ----------

function setupSettings() {
  $("settings-btn").addEventListener("click", openSettings);
  $("settings-cancel").addEventListener("click", closeSettings);
  $("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("settings-error").textContent = "";
    const cfg = {
      owner: $("cfg-owner").value.trim(),
      repo: $("cfg-repo").value.trim(),
      pat: $("cfg-pat").value.trim(),
    };
    if (!cfg.owner || !cfg.repo || !cfg.pat) {
      $("settings-error").textContent = "All three fields are required.";
      return;
    }
    state.config = cfg;
    localStorage.setItem(LS_CFG, JSON.stringify(cfg));
    closeSettings();
    try {
      await loadData();
      renderTree();
      const last = localStorage.getItem(LS_LAST);
      if (last && findNode(last)) openDoc(last);
      else showEmpty();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
}

function openSettings() {
  if (state.config) {
    $("cfg-owner").value = state.config.owner;
    $("cfg-repo").value = state.config.repo;
    $("cfg-pat").value = state.config.pat;
  }
  $("settings-modal").classList.remove("hidden");
  $("cfg-owner").focus();
}

function closeSettings() {
  $("settings-modal").classList.add("hidden");
}

// ---------- Passcode gate ----------

function setupGate() {
  return new Promise((resolve) => {
    const stored = localStorage.getItem(LS_PASS);
    const form = $("gate-form");
    const input = $("gate-input");
    const confirmInput = $("gate-confirm-input");
    const submit = $("gate-submit");
    const promptEl = $("gate-prompt");
    const errEl = $("gate-error");

    const setting = !stored;
    if (setting) {
      promptEl.textContent = "Set a passcode (you'll use this to unlock Noaty)";
      confirmInput.style.display = "block";
      submit.textContent = "Set passcode";
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errEl.textContent = "";

      if (setting) {
        const v = input.value;
        const c = confirmInput.value;
        if (!v) {
          errEl.textContent = "Enter a passcode";
          return;
        }
        if (v.length < 4) {
          errEl.textContent = "At least 4 characters please";
          return;
        }
        if (v !== c) {
          errEl.textContent = "Passcodes don't match";
          return;
        }
        const h = await sha256Hex(v);
        localStorage.setItem(LS_PASS, h);
        resolve();
        return;
      }

      if (Date.now() < state.cooldownUntil) {
        const remain = Math.ceil((state.cooldownUntil - Date.now()) / 1000);
        errEl.textContent = `Too many attempts. Wait ${remain}s.`;
        return;
      }
      const h = await sha256Hex(input.value);
      if (h === stored) {
        resolve();
      } else {
        state.failedAttempts += 1;
        if (state.failedAttempts >= MAX_ATTEMPTS) {
          state.cooldownUntil = Date.now() + COOLDOWN_MS;
          state.failedAttempts = 0;
          errEl.textContent = "Wrong passcode. 30s cooldown.";
        } else {
          errEl.textContent = `Wrong passcode (${state.failedAttempts}/${MAX_ATTEMPTS})`;
        }
        input.value = "";
        input.focus();
      }
    });
  });
}

// ---------- Top-level wiring ----------

function setupSidebarButtons() {
  $("new-folder").addEventListener("click", () => newFolder(null));
  $("new-doc").addEventListener("click", () => newDoc(null));
  $("lock-btn").addEventListener("click", () => location.reload());
}

async function init() {
  await setupGate();
  $("gate").classList.add("hidden");
  $("app").classList.remove("hidden");

  setupSettings();
  setupSidebarButtons();
  setupEditor();

  const cfgStr = localStorage.getItem(LS_CFG);
  if (cfgStr) {
    try {
      state.config = JSON.parse(cfgStr);
    } catch {
      state.config = null;
    }
  }

  if (!state.config) {
    setStatus("No GitHub sync configured yet — open Settings.");
    openSettings();
    return;
  }

  try {
    await loadData();
    renderTree();
    const last = localStorage.getItem(LS_LAST);
    if (last && findNode(last)) openDoc(last);
  } catch (err) {
    setStatus(err.message, "error");
  }
}

init();
