# DuoForge — setup plan (for an AI assistant)

You are an AI assistant (Claude Code, Codex…) setting up **Duo** for a user. Duo is a local chat where
**Claude** and **ChatGPT** work together on one project. It uses the user's **own** logins (Claude Code CLI and
the Codex CLI), never API keys and never someone else's account. Follow the steps in order; stop and ask the user
when a step needs them (logins, decisions). Never ask for, type or store passwords or tokens.

## 1. Check the requirements
- Node.js 18+ : `node --version`
- Claude Code CLI, logged in : `claude --version`, then `echo "Reply PONG" | claude -p --output-format text`
  should print `PONG` in ~10 s. If not logged in, ask the user to run `claude` and `/login` themselves.
- Codex CLI, logged in with ChatGPT : `codex --version`, then `codex exec --skip-git-repo-check -s read-only "Reply PONG"`.
  On Windows with the Codex app, the CLI may be at `%USERPROFILE%\.codex\plugins\.plugin-appserver\codex.exe`
  (set `CODEX_EXE` to that path). If not logged in, ask the user to log in themselves.

## 2. Known pitfall: a stale Anthropic proxy
If `claude -p` hangs for minutes, check for `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` in the environment
(often left by an old tool). Duo already removes them for its Claude calls. Do not delete them system-wide
without asking the user; never print their values.

## 3. Install
- Copy `server.js`, `index.html`, `logo.svg` and `lancer.cmd` into the project (e.g. `tools/duo/`), or anywhere and set
  `DUO_PROJECT` to the project folder.
- Add to `.gitignore` : `tools/duo/conversation.json`.
- Optional: a `NOTES.md` at the project root (or `DUO_NOTES=<file>`): its first 40 lines are given to both AIs.
- Edit the prompts in `server.js` (`prompt()`, `ROLES` and the short `ROLE_LABELS` shown in the page) for the
  user's project, language and team roles.

## 4. Optional: tools for Claude in team mode
Set `DUO_MCP` to an MCP config JSON file (same format as Claude Code's `--mcp-config`) to give Claude extra tools
in Team mode. Their apps must be running.

## 5. Start and check
- Run `node tools/duo/server.js` (or double-click `lancer.cmd`), open `http://localhost:4747`.
- The console must show the project folder, the ChatGPT path (with the web switches turned off) and the connectors.
- First test in **Discuss** mode (no file changes, fast, cheap). Only then try **Team** with 4 turns max
  and a small task. The **Stop** button kills both AIs at once.

## 6. Security rules (do not weaken them)
- The server listens on `127.0.0.1` only. Never expose it (no `0.0.0.0`, no tunnel, no port forwarding).
- Every API call needs the per-launch secret that only the served page knows; the `Host` header must be
  `localhost`/`127.0.0.1`; POST must be JSON. These block other websites from driving the AIs.
- In team mode the AIs can run commands and edit files: use it on a project under git, review `git diff`,
  and keep web access disabled (prompt injection). Claude runs without WebFetch / WebSearch; Codex runs with
  `web_search="disabled"` and without apps, plugins, browser and computer use (`codexNoWeb()` in `server.js`).
  Codex shell commands have no network in its sandbox.
- One account per person. Do not rotate several accounts to get around usage limits (against the providers' terms).

---
DuoForge is made by **4me89** — https://github.com/4me89/DuoForge
