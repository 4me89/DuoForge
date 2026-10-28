// DuoForge — Claude and ChatGPT working together on your project, in one local chat.
// Made by 4me89 · https://github.com/4me89/DuoForge · MIT License
// Start: node server.js, then open http://localhost:4747. See SETUP.md.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");
const crypto = require("crypto");

const PORT = Number(process.env.DUO_PORT) || 4747;
const HERE = __dirname;
// Project folder: DUO_PROJECT (or DUO_PROJET), or the project that holds tools/duo/ when DuoForge is installed there.
const PROJECT_ENV = process.env.DUO_PROJECT || process.env.DUO_PROJET;
const INSTALLED = path.basename(HERE) === "duo" && path.basename(path.dirname(HERE)) === "tools";
if (!PROJECT_ENV && !INSTALLED) {
  console.log("Set DUO_PROJECT to your project folder first, e.g.  set DUO_PROJECT=C:\\path\\to\\project  (see SETUP.md).");
  process.exit(1);
}
const REPO = path.resolve(PROJECT_ENV || path.join(HERE, "..", ".."));
const SAVE = path.join(HERE, "conversation.json");
const PLAN = path.join(REPO, "PLAN.md");
const MCP = path.join(os.tmpdir(), "duo_mcp_claude.json");
const TIMEOUT = { travail: 12 * 60 * 1000, discussion: 3 * 60 * 1000 };
const HISTORY = 30; // messages sent to each AI
// Security: a random secret for each launch, only written into the page DuoForge serves.
// Another website cannot read that page, so it cannot know the secret or drive the AIs.
const SECRET = crypto.randomBytes(24).toString("hex");
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]); // against DNS rebinding
const NAMES = { toi: "User", claude: "Claude", chatgpt: "ChatGPT", systeme: "System" };

function findCodex() {
  const candidates = [process.env.CODEX_EXE, path.join(os.homedir(), ".codex", "plugins", ".plugin-appserver", "codex.exe")];
  return candidates.filter(Boolean).find((p) => fs.existsSync(p)) || "codex";
}
const CODEX = findCodex();

// No web for ChatGPT (like Claude): built-in search, ChatGPT apps, plugins and browser / computer-use tools off.
// Only the switches this Codex version knows: an unknown one makes codex stop.
function codexNoWeb() {
  const args = ["-c", 'web_search="disabled"'];
  try {
    const known = execSync(`"${CODEX}" features list`, { encoding: "utf8", windowsHide: true });
    for (const f of ["apps", "plugins", "browser_use", "computer_use", "in_app_browser"]) {
      if (new RegExp(`^${f}\\s`, "m").test(known)) args.push("--disable", f);
    }
  } catch {}
  try {
    const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    const cfg = fs.readFileSync(path.join(home, "config.toml"), "utf8");
    if (/^\[mcp_servers\.node_repl\]/m.test(cfg)) args.push("-c", "mcp_servers.node_repl.enabled=false"); // Codex app browser
  } catch {}
  return args;
}
const CODEX_NO_WEB = codexNoWeb();

// Optional MCP tools for Claude in team mode: set DUO_MCP to an MCP config JSON file.
function writeMcpConfig() {
  const src = process.env.DUO_MCP;
  const cfg = src && fs.existsSync(src) ? JSON.parse(fs.readFileSync(src, "utf8")) : { mcpServers: {} };
  fs.writeFileSync(MCP, JSON.stringify(cfg, null, 1));
  return Object.keys(cfg.mcpServers || {});
}
const CONNECTEURS = writeMcpConfig();

let messages = fs.existsSync(SAVE) ? JSON.parse(fs.readFileSync(SAVE, "utf8")) : [];
let busy = null; // "claude" | "chatgpt" | null
let busySince = 0;
let stopAsked = false;
let current = null; // the running process (for Stop)

function save() {
  fs.writeFileSync(SAVE, JSON.stringify(messages, null, 1));
}

function add(who, text, extra = {}) {
  messages.push({ who, text: text.trim(), at: new Date().toISOString(), ...extra });
  save();
}

// Project summary: recent commits + start of the notes file + the team plan
function context() {
  const parts = [];
  try {
    parts.push("Recent commits (git):\n" + execSync("git log --oneline -10", { cwd: REPO, encoding: "utf8" }).trim());
  } catch {}
  const notes = path.join(REPO, process.env.DUO_NOTES || "NOTES.md"); // optional notes for the AIs
  if (fs.existsSync(notes)) parts.push(`Project notes (start of ${path.basename(notes)}):\n` + fs.readFileSync(notes, "utf8").split("\n").slice(0, 40).join("\n"));
  if (fs.existsSync(PLAN)) parts.push("TEAM PLAN (PLAN.md):\n" + fs.readFileSync(PLAN, "utf8"));
  return parts.join("\n\n");
}

// Team roles (edit them for your project)
const ROLES = {
  claude: "code and implementation (edit files, run commands and tools), and git commits when a step works.",
  chatgpt: "images (you can generate them: icons, sketches, textures, saved as PNG in the project), "
    + "reviewing Claude's work (bugs, ideas), and code when needed. No git push: Claude does it.",
};
// The same roles in a few words, shown in the page
const ROLE_LABELS = {
  claude: "Code, commands, tools and git commits",
  chatgpt: "Images, reviews, and code when needed",
};
const LOGO_FILE = path.join(HERE, "logo.svg"); // DuoForge logo (page, tab icon)
const LOGO = fs.existsSync(LOGO_FILE) ? fs.readFileSync(LOGO_FILE, "utf8") : '<svg xmlns="http://www.w3.org/2000/svg"/>';

function prompt(me, mode) {
  const other = me === "claude" ? "ChatGPT" : "Claude";
  const lines = messages.slice(-HISTORY).map((m) => `### ${NAMES[m.who] || m.who}\n${m.text}`);
  const common = [
    `You are ${NAMES[me]}. You work AS A TEAM with ${other} on the user's project (folder: ${REPO}).`,
    "You are in the same chat: you see their messages and they see yours.",
    "",
    "Rules:",
    "- Answer in the user's language, short and clear.",
    `- React to what ${other} REALLY wrote above. If they said nothing yet, don't talk about their answer.`,
    "- Don't start with your name (the chat shows it).",
  ];
  if (mode === "equipe") {
    common.push(
      "",
      "TEAM MODE: you really work, taking turns.",
      `- Your role: ${ROLES[me]}`,
      `- ${other}'s role: ${ROLES[me === "claude" ? "chatgpt" : "claude"]}`,
      "- Do ONE useful, logical step (the next one in the plan) with your tools, and check it works.",
      `- If you disagree with ${other}, say so and propose better (one round of debate, then decide).`,
      "- Keep PLAN.md up to date: short task list, who does what, [x] when done.",
      "- Don't delete important files, don't publish anything.",
      "- Your message: 3 to 8 lines: what you did, the result, what's next.",
      "- LAST LINE, required, exactly one of: \"NEXT: claude\", \"NEXT: chatgpt\" or \"NEXT: user\"",
      "  (user = the user must decide, test or act, or it's done).",
    );
  } else {
    common.push(
      "- DISCUSS MODE: don't read or edit any file, don't run commands. Answer right away, 3 to 8 lines.",
      "- Split the work: say clearly who would do what.",
    );
  }
  return [...common, "", context(), "", "Conversation (newest at the bottom):", "", ...lines, "", `### ${NAMES[me]} (you, now)`].join("\n");
}

function killTree(child) {
  if (!child) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  else child.kill();
}

function run(cmd, args, input, outFile, timeout, extraEnv = {}) {
  return new Promise((resolve) => {
    // A stale ANTHROPIC_BASE_URL / AUTH_TOKEN can make claude hang: Claude uses the normal login instead.
    const env = { ...process.env, ...extraEnv };
    if (cmd === "claude") for (const k of ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"]) delete env[k];
    // On Windows a bare name (claude, codex) is often a .cmd file: it needs the shell, with quoted paths.
    const shell = process.platform === "win32" && !path.isAbsolute(cmd);
    const quote = (a) => (/\s/.test(a) ? `"${a}"` : a);
    const child = shell
      ? spawn([cmd, ...args.map(quote)].join(" "), { cwd: REPO, env, shell: true, windowsHide: true })
      : spawn(cmd, args, { cwd: REPO, env, windowsHide: true });
    current = child;
    child.stdin.on("error", () => {}); // the process may die before reading the prompt
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      err += " (took too long: stopped)";
      killTree(child);
    }, timeout);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => (err += String(e)));
    child.on("close", (code) => {
      clearTimeout(timer);
      current = null;
      if (outFile && fs.existsSync(outFile)) {
        out = fs.readFileSync(outFile, "utf8");
        fs.unlinkSync(outFile);
      }
      resolve({ ok: code === 0 && out.trim() !== "", text: out.trim() || err.trim().slice(-600) });
    });
    child.stdin.end(input);
  });
}

async function ask(me, mode) {
  busy = me;
  busySince = Date.now();
  const p = prompt(me, mode);
  const working = mode === "equipe";
  const timeout = working ? TIMEOUT.travail : TIMEOUT.discussion;
  let r;
  if (me === "claude") {
    // Opus for Claude
    const args = working
      ? ["-p", "--output-format", "text", "--model", "opus", "--permission-mode", "acceptEdits", "--mcp-config", MCP,
         "--allowedTools", ["Read,Grep,Glob,Edit,Write,Bash,PowerShell", ...CONNECTEURS.map((n) => `mcp__${n.replace(/[^\w-]/g, "_")}`)].join(","),
         "--disallowedTools", "WebFetch,WebSearch"] // no web: a booby-trapped page cannot give them orders
      : ["-p", "--output-format", "text", "--model", "opus", "--permission-mode", "default", "--max-turns", "1",
         "--disallowedTools", "Read,Grep,Glob,Edit,Write,NotebookEdit,Bash,PowerShell,WebFetch,WebSearch,Task,Agent"];
    r = await run("claude", args, p, null, timeout);
    if (!r.ok && /authenticat|OAuth|token/i.test(r.text)) r = await run("claude", args, p, null, timeout); // retry once
  } else {
    const out = path.join(os.tmpdir(), `duo_chatgpt_${Date.now()}.txt`);
    const args = ["exec", ...CODEX_NO_WEB, "--skip-git-repo-check", "-C", REPO, "-s", working ? "workspace-write" : "read-only", "-o", out];
    if (!working) args.push("-c", "model_reasoning_effort=\"low\"");
    r = await run(CODEX, [...args, "-"], p, out, timeout);
  }
  busy = null;
  if (!r.ok) {
    add("systeme", `${NAMES[me]} could not answer: ${r.text}`, { mode });
    return "user";
  }
  const m = r.text.match(/(?:NEXT|SUITE)\s*:\s*(claude|chatgpt|user)\s*$/i);
  const next = m ? m[1].toLowerCase() : null;
  add(me, m ? r.text.slice(0, m.index) : r.text, { mode, next });
  return next;
}

async function round(mode, tours, first) {
  stopAsked = false;
  if (mode === "equipe") {
    // they hand over to each other; "tours" = the most steps
    let who = first === "chatgpt" ? "chatgpt" : "claude";
    for (let i = 0; i < tours && !stopAsked; i++) {
      const next = await ask(who, mode);
      if (!next || next === "user") break;
      who = next === who ? (who === "claude" ? "chatgpt" : "claude") : next;
    }
    return;
  }
  const order = first === "chatgpt" ? ["chatgpt", "claude"] : ["claude", "chatgpt"];
  for (let i = 0; i < tours && !stopAsked; i++) {
    for (const who of order) {
      if (stopAsked) break;
      await ask(who, mode);
    }
  }
}

function body(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (d) => (s += d));
    req.on("end", () => {
      try {
        resolve(JSON.parse(s || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function send(res, code, data, type = "application/json") {
  res.writeHead(code, { "Content-Type": type + "; charset=utf-8", "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(data) : data);
}

http
  .createServer(async (req, res) => {
    if (!HOSTS.has(req.headers.host || "")) return send(res, 403, { error: "host refused" });
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'");
      res.setHeader("X-Frame-Options", "DENY");
      return send(res, 200, fs.readFileSync(path.join(HERE, "index.html"), "utf8").replace("__DUO_SECRET__", SECRET), "text/html");
    }
    if (req.method === "GET" && (req.url === "/logo.svg" || req.url === "/favicon.ico")) return send(res, 200, LOGO, "image/svg+xml");
    const ok = crypto.timingSafeEqual(Buffer.from(String(req.headers["x-duo-secret"] || "").padEnd(48).slice(0, 48)), Buffer.from(SECRET));
    if (!ok) return send(res, 403, { error: "missing secret" });
    if (req.method === "POST" && !(req.headers["content-type"] || "").startsWith("application/json")) {
      return send(res, 415, { error: "JSON only" });
    }
    if (req.method === "GET" && req.url === "/api/state") {
      const plan = fs.existsSync(PLAN) ? fs.readFileSync(PLAN, "utf8") : "";
      return send(res, 200, {
        messages, busy, since: busy ? Date.now() - busySince : 0, plan, connecteurs: CONNECTEURS,
        projet: path.basename(REPO), dossier: REPO, roles: ROLE_LABELS,
      });
    }
    if (req.method === "POST" && req.url === "/api/send") {
      if (busy) return send(res, 409, { error: "busy" });
      const b = await body(req);
      const mode = b.mode === "equipe" ? "equipe" : "discuter";
      if (b.text && b.text.trim()) add("toi", b.text, { mode });
      const max = mode === "equipe" ? 12 : 4;
      round(mode, Math.max(1, Math.min(max, Number(b.rounds) || 1)), b.first).catch((e) => {
        busy = null;
        add("systeme", `Error: ${e.message}`, { mode });
      });
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/api/stop") {
      stopAsked = true;
      killTree(current);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/api/clear") {
      if (busy) return send(res, 409, { error: "busy" });
      messages = [];
      save();
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: "not found" });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`DuoForge ready: http://localhost:${PORT}  (project: ${REPO})`);
    console.log(`ChatGPT: ${CODEX}  (web off: ${CODEX_NO_WEB.filter((a) => !a.startsWith("-")).join(", ")})`);
    console.log(`Claude's MCP tools: ${CONNECTEURS.join(", ") || "none"}`);
  });
