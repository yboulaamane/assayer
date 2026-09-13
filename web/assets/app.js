import { icon } from "./icons.js";
import { resolveQuery, findTarget, findStructures, alphafold, buildPlan, planToMarkdown, PROTOCOL_LIST } from "./workflow.js";

const app = document.getElementById("app");
let DATA = null, BY_NAME = new Map(), BY_ID = new Map(), STAGE = new Map();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hue = (slug) => STAGE.get(slug)?.hue ?? 220;

/* ------------------------------------------------------------------- theme */
const themeBtn = document.getElementById("theme");
try {
  const saved = localStorage.getItem("atlas-theme");
  if (saved) document.documentElement.dataset.theme = saved;
} catch {}
themeBtn.onclick = () => {
  const cur = document.documentElement.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("atlas-theme", next); } catch {}
};

/* -------------------------------------------------------------------- data */
async function boot() {
  const r = await fetch("catalog.json");
  DATA = await r.json();
  for (const s of DATA.stages) STAGE.set(s.slug, s);
  const alias = (k, t) => { if (k && !BY_NAME.has(k)) BY_NAME.set(k, t); };
  for (const t of DATA.tools) {
    BY_ID.set(t.id, t);
    alias(norm(t.name), t);
    alias(norm(t.name).replace(/\s+/g, ""), t);          // "Target Diff" -> targetdiff
    if (t.repo) alias(norm(t.repo.split("/")[1]), t);     // "gnina/gnina" -> gnina
  }
  addEventListener("hashchange", route);
  route();
}

/* ------------------------------------------------------------------ router */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  return { path: path || "", params: new URLSearchParams(qs || "") };
}
let lastView = null;

function route() {
  const { path, params } = parseHash();
  const seg = path.split("/");

  // Opening or closing a tool only changes the drawer, re-rendering the grid
  // underneath would throw away scroll position and everything lazily loaded.
  const keyParams = new URLSearchParams(params);
  keyParams.delete("tool");
  const viewKey = `${path}?${keyParams}`;
  const sameView = viewKey === lastView;
  lastView = viewKey;

  if (sameView) {
    const t = params.get("tool");
    if (t) openDrawer(t); else closeDrawer();
    return;
  }

  document.querySelectorAll("nav.main a").forEach((a) => a.classList.remove("on"));
  const mark = (r) => document.querySelector(`nav.main a[data-route="${r}"]`)?.classList.add("on");

  if (seg[0] === "browse") { mark("browse"); renderBrowse(params); }
  else if (seg[0] === "stage") { mark("browse"); renderBrowse(new URLSearchParams({ stage: seg[1] || "" })); }
  else if (seg[0] === "workflow") { mark("workflow"); renderWorkflow(params); }
  else { mark("home"); renderHome(); }

  scrollTo({ top: 0 });
  if (params.get("tool")) openDrawer(params.get("tool")); else closeDrawer();
}

/* -------------------------------------------------------------------- home */
function renderHome() {
  const curated = DATA.tools.filter((t) => t.curated).length;
  const repos = DATA.tools.filter((t) => t.repo).length;
  app.innerHTML = `
  <div class="wrap">
    <section class="hero">
      <h1>Every tool in the pipeline, and <em>the order to use them in</em>.</h1>
      <p class="lede">${DATA.tools.length} tools for medicinal and computational chemistry, across
      ${DATA.stages.length} stages from target to synthesis. Browse by stage, or describe what you are
      trying to do and get a protocol with the receptor already chosen for you.</p>
      <div class="stat-row">
        <div class="stat"><b>${DATA.tools.length}</b><span>tools</span></div>
        <div class="stat"><b>${DATA.stages.length}</b><span>stages</span></div>
        <div class="stat"><b>${repos}</b><span>with code</span></div>
        <div class="stat"><b>${curated}</b><span>curated standards</span></div>
      </div>
      <div class="searchbar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
        <input id="q" placeholder="Search ${DATA.tools.length} tools, docking, single cell, ADMET, foldseek…" autocomplete="off">
        <kbd>/</kbd>
      </div>
    </section>

    <div class="section-head"><h2>Browse by stage</h2><span>where it sits in the pipeline</span></div>
    <div class="stage-grid">
      ${DATA.stages.filter((s) => s.count).map((s) => `
        <a class="stage-card" href="#/stage/${s.slug}" style="--h:${s.hue}">
          <div class="top-row"><span class="badge">${icon(s.slug)}</span><span class="n">${s.count}</span></div>
          <h3>${esc(s.label)}</h3><p>${esc(s.blurb)}</p>
        </a>`).join("")}
    </div>

    <div class="section-head"><h2>Or start from the question</h2><span>the protocol comes with the tools attached</span></div>
    <div class="stage-grid">
      ${[
        ["Find inhibitors of EGFR in human", "hit-discovery", "docking"],
        ["Optimise my lead series against CDK2", "lead-opt", "generative"],
        ["My fragment screen gave 40 hits, which should I grow?", "fbdd", "binding-site"],
        ["Profile ADMET for my compound set", "admet", "admet"],
      ].map(([q, _i, s]) => `
        <a class="stage-card" href="#/workflow?q=${encodeURIComponent(q)}" style="--h:${hue(s)}">
          <div class="top-row"><span class="badge">${icon(s)}</span><span class="n">plan →</span></div>
          <h3>${esc(q)}</h3><p>Step-by-step, with gates you have to pass before the next step.</p>
        </a>`).join("")}
    </div>
  </div>`;

  const q = document.getElementById("q");
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && q.value.trim()) location.hash = `#/browse?q=${encodeURIComponent(q.value.trim())}`;
  });
}

/* ------------------------------------------------------------------ browse */
let browseState = { shown: 0, list: [], io: null };

function renderBrowse(params) {
  const stage = params.get("stage") || "";
  const q = params.get("q") || "";
  const src = params.get("src") || "";
  const acc = params.get("acc") || "";

  const list = DATA.tools.filter((t) => {
    if (stage && t.stage !== stage) return false;
    if (src === "curated" && !t.curated) return false;
    if (src === "code" && !t.repo) return false;
    if (acc && (t.license || "").toLowerCase() !== acc) return false;
    if (q) {
      const hay = norm(`${t.name} ${t.description} ${(t.tags || []).join(" ")}`);
      if (!norm(q).split(" ").every((w) => hay.includes(w))) return false;
    }
    return true;
  });

  const st = stage ? STAGE.get(stage) : null;
  const chip = (label, key, val, count) => {
    const p = new URLSearchParams(params);
    const on = (params.get(key) || "") === val;
    if (on) p.delete(key); else p.set(key, val);
    p.delete("tool");
    return `<a class="chip ${on ? "on" : ""}" href="#/browse?${p}">${esc(label)}${
      count != null ? `<span class="cnt">${count}</span>` : ""}</a>`;
  };

  app.innerHTML = `
  <div class="wrap">
    <section class="hero" style="padding-bottom:8px">
      <h1 style="font-size:clamp(26px,3.4vw,34px);margin-bottom:10px">${esc(st ? st.label : "All tools")}</h1>
      <p class="lede">${esc(st ? st.blurb : "Everything in the atlas. Hover a card to read what it does, click for links and sources.")}</p>
      <div class="searchbar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
        <input id="q" placeholder="Filter by name, description or tag…" value="${esc(q)}" autocomplete="off">
        <kbd>/</kbd>
      </div>
    </section>

    <div class="toolbar">
      ${chip("All stages", "stage", "")}
      ${DATA.stages.filter((s) => s.count).map((s) => chip(s.label, "stage", s.slug, s.count)).join("")}
    </div>
    <div class="toolbar">
      ${chip("Curated standards", "src", "curated")}
      ${chip("Has code", "src", "code")}
      ${chip("Open source", "acc", "open-source")}
      ${chip("Free web", "acc", "free-web")}
      ${chip("Commercial", "acc", "commercial")}
      <span class="spacer"></span>
      <span class="count-note">${list.length} of ${DATA.tools.length}</span>
    </div>

    <div class="tool-grid" id="grid"></div>
    <div class="sentinel" id="sentinel"></div>
    ${list.length ? "" : `<div class="empty">Nothing matches that. Try a broader term.</div>`}
  </div>`;

  browseState.io?.disconnect();
  browseState = { shown: 0, list, io: null };
  const grid = document.getElementById("grid");
  const more = () => {
    const next = browseState.list.slice(browseState.shown, browseState.shown + 60);
    grid.insertAdjacentHTML("beforeend", next.map(card).join(""));
    browseState.shown += next.length;
    refreshStars(grid);
  };
  more();
  const sent = document.getElementById("sentinel");
  browseState.io = new IntersectionObserver((es) => {
    if (es[0].isIntersecting && browseState.shown < browseState.list.length) more();
  }, { rootMargin: "600px" });
  browseState.io.observe(sent);

  const qi = document.getElementById("q");
  let t;
  qi.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const p = new URLSearchParams(params);
      qi.value.trim() ? p.set("q", qi.value.trim()) : p.delete("q");
      p.delete("tool");
      history.replaceState(null, "", `#/browse?${p}`);
      const k = new URLSearchParams(p); k.delete("tool");
      lastView = `browse?${k}`;
      renderBrowse(p);
      const n = document.getElementById("q");
      n.focus(); n.setSelectionRange(n.value.length, n.value.length);
    }, 180);
  });
}

function card(t) {
  const s = STAGE.get(t.stage);
  return `<button class="tool" style="--h:${s?.hue ?? 220}" data-id="${esc(t.id)}" onclick="location.hash=updateTool('${esc(t.id)}')">
    <div class="head">
      <span class="tile">${icon(t.stage)}</span>
      <span style="min-width:0">
        <span class="nm">${esc(t.name)}</span>
        <span class="sub">${esc(s?.label || t.stage)}</span>
      </span>
    </div>
    <p class="desc">${esc(t.description || "No description recorded in the source.")}</p>
    <div class="foot">
      ${t.curated ? `<span class="pill star">standard</span>` : ""}
      ${t.repo ? `<span class="pill stars" data-repo="${esc(t.repo)}"${t.stars ? "" : " hidden"}>${t.stars ? "★ " + fmtStars(t.stars) : ""}</span>` : ""}
      ${t.license ? `<span class="pill acc">${esc(t.license)}</span>` : ""}
      ${t.repo ? `<span class="pill">${esc(t.repo.split("/")[0])}</span>` : ""}
    </div>
  </button>`;
}
const fmtStars = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n));

// repo -> count, so a repo is asked about once per session however many times
// it appears on screen
const STAR_CACHE = new Map();
let starsDisabled = false;

/** Fill in live star counts for any .pill.stars in `root`. */
async function refreshStars(root) {
  if (starsDisabled || !root) return;
  const slots = [...root.querySelectorAll(".stars[data-repo]")];
  if (!slots.length) return;

  // paint anything already known, then ask about the rest
  const unknown = [];
  for (const el of slots) {
    const repo = el.dataset.repo;
    if (STAR_CACHE.has(repo)) paintStars(el, STAR_CACHE.get(repo));
    else if (!unknown.includes(repo)) unknown.push(repo);
  }
  if (!unknown.length) return;

  for (let i = 0; i < unknown.length; i += 100) {
    const batch = unknown.slice(i, i + 100);
    let counts;
    try {
      const r = await fetch("api/stars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repos: batch }),
      });
      if (r.status === 501) { starsDisabled = true; return; }  // no token: keep baked values
      if (!r.ok) return;
      counts = await r.json();
    } catch {
      return;   // offline or no function: the catalogue values stay as they are
    }
    for (const [repo, n] of Object.entries(counts || {})) STAR_CACHE.set(repo, n);
    for (const el of root.querySelectorAll(".stars[data-repo]")) {
      if (counts[el.dataset.repo] != null) paintStars(el, counts[el.dataset.repo]);
    }
  }
}

function paintStars(el, n) {
  // compact on a card, full number in the detail panel
  el.textContent = el.classList.contains("pill") ? "★ " + fmtStars(n) : n.toLocaleString();
  el.hidden = false;
}

window.updateTool = (id) => {
  const { path, params } = parseHash();
  params.set("tool", id);
  return `#/${path}?${params}`;
};

/* ------------------------------------------------------------------ drawer */
const drawer = document.getElementById("drawer");
const scrim = document.getElementById("scrim");
scrim.onclick = () => {
  const { path, params } = parseHash();
  params.delete("tool");
  location.hash = `#/${path}${params.toString() ? "?" + params : ""}`;
};
addEventListener("keydown", (e) => { if (e.key === "Escape") scrim.onclick(); });
addEventListener("keydown", (e) => {
  if (e.key === "/" && !/input|textarea/i.test(document.activeElement.tagName)) {
    e.preventDefault(); document.getElementById("q")?.focus();
  }
});

const sameUrl = (a, b) => {
  const clean = (u) => (u || "").replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  return clean(a) === clean(b);
};

function codeBlock(label, code, lang) {
  const shown = esc(code).replace(/^(\s*#.*)$/gm, '<span class="cmt">$1</span>');
  return `<div class="code">
    <div class="chead"><span>${esc(label)}</span>
      <button class="copy" data-code="${esc(code)}">Copy</button></div>
    <pre><code class="lang-${esc(lang || "bash")}">${shown}</code></pre>
  </div>`;
}

function installBlock(t) {
  const lines = [];
  if (t.pypi) lines.push(`pip install ${t.pypi}`);
  if (t.conda) lines.push(`conda install -c conda-forge ${t.conda}`);
  if (!lines.length && t.repo) lines.push(`git clone https://github.com/${t.repo}.git`);
  if (!lines.length) return "";
  const note = t.pypi || t.conda ? "" : "\n# no published package, build from source, see the repo";
  return codeBlock("Install", lines.join("\n") + note, "bash");
}

function openDrawer(id) {
  const t = BY_ID.get(id);
  if (!t) return;
  const s = STAGE.get(t.stage);
  const link = (href, label, primary) => href
    ? `<a class="btn ${primary ? "primary" : ""}" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8.5 7H17v8.5"/></svg></a>` : "";
  drawer.innerHTML = `
    <div class="dhead" style="--h:${s?.hue ?? 220}">
      <button class="iconbtn close" onclick="document.getElementById('scrim').onclick()" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
      <div style="display:flex;gap:12px;align-items:center">
        <span class="tile" style="--c:hsl(${s?.hue ?? 220} 46% 38%);width:40px;height:40px;border-radius:11px;display:grid;place-items:center;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent)">${icon(t.stage)}</span>
        <div><h2>${esc(t.name)}</h2>
          <div style="font-size:12.5px;color:var(--ink-3)">${esc(s?.label || t.stage)}</div></div>
      </div>
    </div>
    <div class="dbody">
      <p style="font-size:14px;line-height:1.65;color:var(--ink-2);margin:0 0 20px">${esc(t.description || "No description was recorded for this tool in any source.")}</p>
      <div class="linkrow" style="margin-bottom:6px">
        ${link(t.url, t.url && t.url.includes("github.com") ? "Repository" : "Website", true)}
        ${t.code_url && !sameUrl(t.code_url, t.url) ? link(t.code_url, "Code") : ""}
        ${t.paper_url && !sameUrl(t.paper_url, t.url) ? link(t.paper_url, "Paper") : ""}
      </div>
      ${installBlock(t)}
      ${t.snippet ? codeBlock("Minimal example", t.snippet.code, t.snippet.lang) : ""}
      <div style="height:22px"></div>
      <dl class="kv">
        ${t.license ? `<dt>Access</dt><dd>${esc(t.license)}</dd>` : ""}
        ${t.repo ? `<dt>Repo</dt><dd style="font-family:var(--mono);font-size:12.5px">${esc(t.repo)}</dd>` : ""}
        ${t.year ? `<dt>Year</dt><dd>${esc(t.year)}</dd>` : ""}
        ${t.repo ? `<dt>GitHub stars</dt><dd class="stars" data-repo="${esc(t.repo)}">${
          t.stars ? t.stars.toLocaleString() : "…"}</dd>` : ""}
        ${t.pypi || t.conda ? `<dt>Package</dt><dd style="font-family:var(--mono);font-size:12.5px">${
          [t.pypi ? "pypi: " + esc(t.pypi) : "", t.conda ? "conda-forge: " + esc(t.conda) : ""].filter(Boolean).join("<br>")}</dd>` : ""}
        <dt>Listed in</dt><dd>${t.sources.map((x) => esc({
          "biotools": "bio.tools (ELIXIR, CC-BY 4.0)", "github-topics": "GitHub topic search",
          "curated": "our curated stack",
        }[x] || x.replace("github-stars:", "★ "))).join("<br>")}</dd>
      </dl>
      ${t.tags?.length ? `<div style="font-size:12px;color:var(--ink-3);margin-bottom:8px">Tags from the source</div>
        <div class="foot" style="margin:0">${t.tags.map((x) => `<span class="pill">${esc(x)}</span>`).join("")}</div>` : ""}
      <div style="margin-top:26px">
        <a class="btn" href="#/stage/${t.stage}">See all ${STAGE.get(t.stage)?.count ?? ""} in ${esc(s?.label || t.stage)}</a>
      </div>
    </div>`;
  refreshStars(drawer);
  drawer.querySelectorAll(".copy").forEach((b) => {
    b.onclick = async () => {
      await navigator.clipboard.writeText(b.dataset.code);
      b.textContent = "Copied";
      setTimeout(() => (b.textContent = "Copy"), 1400);
    };
  });
  drawer.hidden = false; scrim.hidden = false;
  requestAnimationFrame(() => { drawer.classList.add("show"); scrim.classList.add("show"); });
}
function closeDrawer() {
  drawer.classList.remove("show"); scrim.classList.remove("show");
  setTimeout(() => { if (!drawer.classList.contains("show")) { drawer.hidden = true; scrim.hidden = true; } }, 240);
}

/* ---------------------------------------------------------------- workflow */
function renderWorkflow(params) {
  const q = params.get("q") || "";
  app.innerHTML = `
  <div class="wrap">
    <section class="hero" style="padding-bottom:0">
      <h1 style="font-size:clamp(26px,3.6vw,36px)">Describe the research question.</h1>
      <p class="lede">You get the protocol, the gates you have to pass, and the tools for each step, with the target resolved and its structures ranked live. The computation stays with you.</p>
      <div class="wf-input">
        <input id="wq" placeholder="e.g. find inhibitors of EGFR in human" value="${esc(q)}" autocomplete="off">
        <button class="btn primary" id="go">Plan it</button>
      </div>
      <div class="examples">
        ${["Find inhibitors of EGFR in human",
           "My fragment screen gave 40 hits, which should I grow?",
           "Design a PROTAC for BRD4 using VHL",
           "Why is my series hitting the wrong kinase?",
           "Rank these analogues with FEP",
           "Conformational sampling of CYP3A4",
           "ADMET and hERG risk for my compound set",
           "Plan a synthesis route for this molecule"]
          .map((x) => `<button data-q="${esc(x)}">${esc(x)}</button>`).join("")}
      </div>
    </section>
    <div id="plan"></div>
  </div>`;

  const input = document.getElementById("wq");
  const go = () => { if (input.value.trim()) location.hash = `#/workflow?q=${encodeURIComponent(input.value.trim())}`; };
  document.getElementById("go").onclick = go;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  document.querySelectorAll(".examples button").forEach((b) => {
    b.onclick = () => { location.hash = `#/workflow?q=${encodeURIComponent(b.dataset.q)}`; };
  });
  if (q) drawPlan(q);
}

function lookupTool(name) {
  const n = norm(name);
  return BY_NAME.get(n) || BY_NAME.get(n.replace(/\s+/g, "")) || null;
}

function toolChip(name) {
  const t = lookupTool(name);
  if (!t) return `<span class="minitool" style="--h:220;cursor:default;opacity:.72">${icon("other")}${esc(name)}</span>`;
  const s = STAGE.get(t.stage);
  return `<a class="minitool" style="--h:${s?.hue ?? 220}" href="${window.updateTool(t.id)}">${icon(t.stage)}${esc(t.name)}</a>`;
}

async function drawPlan(q) {
  const host = document.getElementById("plan");
  host.innerHTML = `<p class="count-note" style="margin:18px 0"><span class="spin"></span> Working out which protocol this is…</p>`;

  const parsed = await resolveQuery(q);
  const plan = buildPlan(parsed);

  host.innerHTML = `
    <div class="section-head" style="margin-top:10px">
      <h2>${esc(plan.label)}</h2>
      <span>${plan.steps.length} steps${parsed.target ? ` · target: ${esc(parsed.target)}` : ""}${parsed.organism ? ` · ${esc(parsed.organism.label)}` : ""}
        · <span title="${parsed.via === "llm" ? "Routed by the LLM because the keyword router was unsure" : "Matched on keywords, no model call needed"}">${parsed.via === "llm" ? "routed by model" : "routed by keywords"}${parsed.reason ? `: ${esc(parsed.reason)}` : ""}</span></span>
      <span class="spacer"></span>
    </div>
    <p class="lede" style="margin:-6px 0 20px;max-width:78ch">${esc(plan.summary)}</p>
    ${parsed.matched === false ? `<div class="nomatch">
      <b>Nothing matched that question.</b> Assayer plans a fixed set of workflows, and yours did not
      land on one, so what follows is the closest guess rather than an answer. Try naming the task
      directly, or pick one:
      <div class="minitools" style="margin-top:10px">${PROTOCOL_LIST().map((p) =>
        `<a class="minitool" style="--h:200" href="#/workflow?q=${encodeURIComponent(p.label)}">${esc(p.label)}</a>`).join("")}</div>
    </div>` : ""}
    ${plan.decision || plan.stop ? `<div class="frame">
      ${plan.decision ? `<div class="dec"><span class="lab">This decides</span>${esc(plan.decision)}</div>` : ""}
      ${plan.stop ? `<div class="kill"><span class="lab">Stop if</span>${esc(plan.stop)}</div>` : ""}
    </div>` : ""}
    <div id="target-box"></div>
    <div id="tailor-slot"></div>
    <div class="plan">${plan.steps.map((s, i) => `
      <div class="step">
        <div class="rail"><div class="dot">${i + 1}</div><div class="line"></div></div>
        <div class="body">
          <h3>${esc(s.title)}</h3>
          <p class="why">${esc(s.why)}</p>
          ${s.gate ? `<p class="gate"><b>Gate:</b> ${esc(s.gate)}</p>` : ""}
          ${s.pitfall ? `<p class="pit"><b>Common failure:</b> ${esc(s.pitfall)}</p>` : ""}
          ${s.live === "structures" ? `<div id="struct-slot">${parsed.target ? "" :
            `<p class="count-note" style="margin:0 0 12px">Name a protein in your question and the ranked PDB table appears here.</p>`}</div>` : ""}
          ${s.tools?.length ? `<div class="minitools">${s.tools.map(toolChip).join("")}</div>` : ""}
        </div>
      </div>`).join("")}
    </div>
    <div style="display:flex;gap:8px;margin:10px 0 0">
      <button class="btn" id="dl">Download as Markdown</button>
      <button class="btn" id="cp">Copy protocol</button>
    </div>
    <p class="note" style="margin-top:18px">Nothing on this page runs docking, MD or enrichment, those are yours to run
      on your own machine or cluster. This plans the work and tells you what each step has to prove.</p>`;

  let target = null, structures = [];
  const box = document.getElementById("target-box");
  const slot = () => document.getElementById("struct-slot");

  if (parsed.target) {
    box.innerHTML = `<p class="count-note" style="margin-bottom:18px"><span class="spin"></span> Resolving <b>${esc(parsed.target)}</b> in UniProt…</p>`;
    try {
      const hits = await findTarget(parsed.target, parsed.organism);
      const asked = parsed.organism?.label || null;
      const got = hits[0]?.organism || null;
      const mismatch = asked && got && !got.toLowerCase().startsWith(asked.toLowerCase().split(" ")[0]);
      if (!hits.length) {
        box.innerHTML = `<p class="note" style="margin:0 0 20px">No reviewed UniProt entry matched “${esc(parsed.target)}”. The protocol below still applies, resolve the target by hand and carry on.</p>`;
      } else {
        target = hits[0];
        box.innerHTML = `
          <div class="tbl-wrap" style="margin:0 0 24px;padding:16px 18px">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3);margin-bottom:6px">Target resolved</div>
            <div style="font:500 17px/1.3 var(--serif)">${esc(target.name)}</div>
            <div style="font-size:13px;color:var(--ink-2);margin-top:5px">
              <a href="https://www.uniprot.org/uniprotkb/${esc(target.accession)}" target="_blank" rel="noopener" style="font-family:var(--mono)">${esc(target.accession)}</a>
              · ${esc(target.gene || "—")} · ${esc(target.organism || "")} · ${target.length} aa
              ${hits.length > 1 ? ` · <span style="color:var(--ink-3)">${hits.length - 1} other match${hits.length > 2 ? "es" : ""}</span>` : ""}
            </div>
            ${mismatch || hits.droppedOrganism ? `<p class="note" style="margin:12px 0 0">
              <b>Not the species you asked for.</b> You said ${esc(asked)}; the closest entry UniProt holds
              for “${esc(parsed.target)}” is <b>${esc(got || "another organism")}</b>. Sequence and pocket may
              differ, confirm the orthologue before building anything on it.</p>` : ""}
          </div>`;
        if (slot()) {
          slot().innerHTML = `<p class="count-note" style="margin:0 0 12px"><span class="spin"></span> Ranking PDB entries for ${esc(target.accession)}…</p>`;
          const { entries, total } = await findStructures(target.accession, target.organism);
          structures = entries;
          const af = await alphafold(target.accession);
          slot().innerHTML = renderStructures(entries, total, af, target);
        }
      }
    } catch (err) {
      box.innerHTML = `<p class="note" style="margin:0 0 20px"><b>Couldn't reach UniProt / RCSB.</b>
        Sandboxed previews block outbound requests, the deployed site does not. Every step below still applies;
        resolve the target and pick the structure by hand.</p>`;
      if (slot()) slot().innerHTML = "";
    }
  }

  // The protocol is fixed; this is the part that knows about your target.
  // Skip it when nothing matched: commentary on a guess is worse than none.
  if (parsed.matched !== false) tailorPlan(plan, parsed, target, structures);

  const md = () => planToMarkdown(plan, target, structures);
  document.getElementById("dl").onclick = () => {
    const b = new Blob([md()], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = `${plan.id}-protocol.md`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  document.getElementById("cp").onclick = async (e) => {
    await navigator.clipboard.writeText(md());
    e.target.textContent = "Copied";
    setTimeout(() => (e.target.textContent = "Copy protocol"), 1400);
  };
}

async function tailorPlan(plan, parsed, target, structures) {
  const slot = document.getElementById("tailor-slot");
  if (!slot) return;
  const tools = [...new Set(plan.steps.flatMap((s) => s.tools || []))].slice(0, 60);
  slot.innerHTML = `<div class="tailor"><div class="lab">For your case
    <span class="count-note" style="text-transform:none;letter-spacing:0">thinking…</span></div>
    <p id="tailor-text"></p></div>`;
  const para = () => document.getElementById("tailor-text");

  let res;
  try {
    res = await fetch("api/tailor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: parsed.query, label: plan.label,
        steps: plan.steps.map((s) => s.title), tools,
        target: target && { name: target.name, gene: target.gene, organism: target.organism,
                            length: target.length, accession: target.accession },
        structures: (structures || []).slice(0, 3).map((s) => ({
          id: s.id, res: s.res, rfree: s.rfree, holo: s.holo,
          ligand: s.ligands?.[0]?.id || null, title: (s.title || "").slice(0, 90) })),
      }),
    });
    if (!res.ok || !res.body) throw new Error(String(res.status));
  } catch {
    slot.innerHTML = "";   // no key, no function, offline, just omit the section
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = "";
  slot.querySelector(".count-note")?.remove();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    para().innerHTML = paragraphs(text) + `<span class="caret"></span>`;
  }
  if (!text.trim()) { slot.innerHTML = ""; return; }

  // Link any tool it named to its catalogue entry; that is also the check that
  // it only named real ones.
  para().innerHTML = paragraphs(text);
  slot.querySelector(".tailor").insertAdjacentHTML("beforeend",
    `<div class="src">Written for this question by the model, from the protocol above and the
     resolved target. The steps, gates and tool list are curated and unchanged.</div>`);
  linkTools(para());
}

function paragraphs(text) {
  return text.trim().split(/\n{2,}/).map((p) => esc(p.trim())).filter(Boolean)
    .join("</p><p>");
}

function linkTools(el) {
  const names = [...BY_NAME.keys()].filter((n) => n.length > 3);
  let html = el.innerHTML;
  const seen = new Set();
  for (const t of DATA.tools) {
    const n = t.name;
    if (!n || n.length < 4 || seen.has(n.toLowerCase())) continue;
    const re = new RegExp(`(?<![\\w/-])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "g");
    if (!re.test(html)) continue;
    seen.add(n.toLowerCase());
    html = html.replace(re, `<a class="tool" href="${window.updateTool(t.id)}">${esc(n)}</a>`);
    if (seen.size > 12) break;
  }
  el.innerHTML = html;
}

function renderStructures(entries, total, af, target) {
  if (!entries.length) {
    return `<div class="note" style="margin:0 0 12px">No experimental structure is linked to ${esc(target.accession)}.
      ${af ? `Use the predicted model <a href="${esc(af.cif)}" target="_blank" rel="noopener">${esc(af.id)}</a>, and treat low-pLDDT regions as unmodelled rather than flexible.` : ""}</div>`;
  }
  const top = entries.slice(0, 8);
  const best = top[0];
  return `
  <div class="tbl-wrap" style="margin-bottom:12px">
    <table class="struct-table">
      <thead><tr><th>PDB</th><th>Res</th><th>R-free</th><th>State</th><th>Why</th><th>Score</th></tr></thead>
      <tbody>${top.map((s) => `
        <tr class="${s === best ? "best" : ""}">
          <td class="id"><a href="https://www.rcsb.org/structure/${esc(s.id)}" target="_blank" rel="noopener">${esc(s.id)}</a></td>
          <td class="num">${s.res != null ? s.res.toFixed(2) : "—"}</td>
          <td class="num">${s.rfree != null ? s.rfree.toFixed(3) : "—"}</td>
          <td>${s.holo ? `<span class="pill acc" style="--c:hsl(150 46% 34%)">holo</span>` : `<span class="pill">apo</span>`}</td>
          <td style="color:var(--ink-2);font-size:12.5px">${esc(s.reasons.slice(0, 2).join("; "))}</td>
          <td class="num"><span class="score">${s.score}</span></td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  <p class="count-note" style="margin:0 0 10px">Ranked ${entries.length} of ${total} linked entries on resolution,
    R-free, ligand state, method and organism. Top pick: <b>${esc(best.id)}</b>, ${esc(best.title.slice(0, 110))}${best.title.length > 110 ? "…" : ""}
    ${af ? ` · predicted model available: <a href="https://alphafold.ebi.ac.uk/entry/${esc(target.accession)}" target="_blank" rel="noopener">${esc(af.id)}</a>` : ""}</p>
  <p class="note" style="margin:0 0 14px">Score ranks metadata, not biology. Before you commit: check the binding site has no
    missing residues, that the construct is wild-type where it matters, and that the conformational state
    (for kinases, DFG-in vs DFG-out) is the one your chemotype should bind. If several states exist, cross-dock rather than pick.</p>`;
}

boot();
