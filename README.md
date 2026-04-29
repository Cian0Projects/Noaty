# Noaty

A small, single-page notes + todos app. Hosted on GitHub Pages, syncs across devices via a private GitHub repo.

- **Nested folders** of markdown documents
- **Clickable checkboxes** — `- [ ] task` lines render as toggleable checkboxes in view mode
- **Passcode gate** to keep casual eyes out
- **Cross-device sync** by reading/writing a single `noaty.json` in your private data repo

## One-time setup

You need two GitHub things: this public site repo (you already have it), and a separate **private** repo to hold your data.

### 1. Create a private data repo

1. Go to https://github.com/new
2. **Repository name:** `noaty-data` (any name works — just remember it)
3. **Visibility:** **Private** (important — your notes live in here as plain JSON)
4. Tick **Add a README file** so the repo isn't completely empty (Noaty will create `noaty.json` itself on first save)
5. Click **Create repository**

You don't need to add anything else to it. Noaty will create and update `noaty.json` in the root of this repo as you use it.

### 2. Create a fine-grained personal access token (PAT)

1. Go to https://github.com/settings/personal-access-tokens/new
2. **Token name:** `noaty`
3. **Expiration:** 90 days (or whatever you're comfortable with — you'll need to regenerate when it expires)
4. **Repository access:** **Only select repositories** → pick the `noaty-data` repo you just made
5. **Repository permissions:** scroll down to **Contents** → set to **Read and write**
6. Leave everything else alone
7. Click **Generate token** at the bottom and **copy the token now** — you won't be able to see it again

### 3. Enable GitHub Pages on this repo

1. Go to your `Noaty` repo on GitHub → **Settings** → **Pages**
2. **Source:** Deploy from a branch
3. **Branch:** `main` / `/ (root)` → **Save**
4. Wait ~1 minute. The page will be live at `https://<your-username>.github.io/Noaty/`

### 4. First run

1. Open `https://<your-username>.github.io/Noaty/`
2. **Set a passcode** when prompted (this is a UI gate — see security notes below)
3. The Settings modal opens automatically. Enter:
   - **Owner:** your GitHub username
   - **Private data repo name:** `noaty-data` (or whatever you called it)
   - **Personal access token:** paste the PAT
4. Click **Save & sync**. The status bar should say "New data file — will be created on first save" or "Loaded".
5. Click **+ Folder** or **+ Doc** to start.

## Using it

- Click any folder to expand/collapse, or any document to open it.
- Hover a row in the sidebar to reveal rename / delete / (folders only) `+F` / `+D` buttons.
- The main pane has two modes:
  - **View** (default): rendered markdown. Click any checkbox to toggle.
  - **Edit**: raw markdown textarea. Click **Done** to switch back.
- Edits are auto-saved ~1 second after you stop typing. The status bar shows save state.
- **Lock** in the sidebar reloads the page and re-locks behind the passcode.

### Markdown for todos

```markdown
- [ ] not done
- [x] done
- regular bullet (no checkbox)
```

Both `[ ]` and `[x]` render as clickable checkboxes in view mode. Indented sub-tasks work too.

## Security notes (please read)

- **The passcode is a UI gate, not encryption.** Anyone with access to your unlocked browser can bypass it via DevTools. The actual security boundary is *"the data repo is private"*.
- **Your PAT lives in this browser's localStorage.** Treat it like any saved credential. Use a fine-grained PAT scoped to just `noaty-data` with a short expiry, and revoke it if you lose the device.
- If you're using this on a shared computer, click **Lock** when you're done — and consider not saving the PAT there at all (you'll need to re-enter it each session).

## Resetting

- **Forgot passcode?** Open DevTools → Application → Local Storage → delete `noatyPasscodeHash`. Your notes are safe in the data repo. (Also clear `noatyConfig` and re-enter your PAT if needed.)
- **Want to start fresh?** Delete `noaty.json` from the data repo on github.com.
- **Moved to a new device?** Just open the site, set a passcode (it's per-device), enter your settings, and your data appears.

## Limitations (current version)

- No drag-and-drop reordering of the tree (rename works; deleting and re-creating is the workaround for now)
- No search across documents
- No conflict merging — if you edit on two devices simultaneously, the second save shows a "Conflict" message and you reload to pull the latest

## How it works (one paragraph)

Noaty is plain HTML + CSS + ES-module JS, no build step. The whole tree (folders + documents) is one JSON object. On load, Noaty `GET`s `noaty.json` from your data repo via the GitHub Contents API. On every edit, after an 800ms debounce, it `PUT`s the whole file back with the latest `sha`. Markdown is rendered with `marked` (loaded from esm.sh). Clickable checkboxes work by counting `[ ]`/`[x]` occurrences and toggling the matching one in the underlying markdown source, then re-rendering.
