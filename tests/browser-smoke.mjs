// Optional browser checks. Run against the local static server; external APIs
// use fixtures so these checks do not require provider keys or spend quota.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.ASSAYER_TEST_URL || "http://127.0.0.1:8000";
const browser = await chromium.launch();
const catalogue = JSON.parse(readFileSync(new URL("../web/catalog.json", import.meta.url)));

async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth, page: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.page <= dimensions.viewport, `${label}: ${JSON.stringify(dimensions)}`);
}

try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => assert.ok(!request.url().endsWith("/api/stars")));
    await page.route("**/api/**", (route) => route.fulfill({ status: 501, json: { fallback: true } }));
    await page.goto(base);
    await page.locator(".stage-card").first().waitFor();
    await noOverflow(page, `home ${width}`);
    assert.equal(await page.locator("#drawer").isVisible(), false);
    await page.getByRole("button", { name: "Switch theme" }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await noOverflow(page, `dark home ${width}`);
    await page.getByRole("button", { name: "Switch theme" }).click();
    await page.getByRole("link", { name: "All tools", exact: true }).click();
    await page.locator(".tool-grid .tool").first().waitFor();
    assert.equal(await page.locator(".stars[data-repo]").count(), 0);
    await page.getByRole("link", { name: "Open source", exact: true }).click();
    const mitTool = catalogue.tools.find((t) => t.license === "MIT");
    await page.getByRole("textbox", { name: "Filter tools" }).fill(mitTool.name);
    await page.waitForFunction((name) => location.hash.includes(encodeURIComponent(name).replace(/%20/g, "+")), mitTool.name);
    await page.locator(".tool-grid .tool").filter({ hasText: mitTool.name }).first().click();
    await page.locator("#drawer.show").waitFor();
    await noOverflow(page, `drawer ${width}`);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator("#drawer").waitFor({ state: "hidden" });
    await page.getByRole("textbox", { name: "Filter tools" }).fill("zzzz-no-matching-tool-zzzz");
    await page.getByText("Nothing matches that.", { exact: false }).waitFor();
    await noOverflow(page, `browse ${width}`);
    await page.getByRole("link", { name: "Plan a workflow", exact: true }).click();
    await page.getByRole("textbox", { name: "Research question" }).fill("Profile ADMET for my compound set");
    await page.getByRole("button", { name: "Plan it", exact: true }).click();
    await page.locator(".plan .step").first().waitFor();
    await page.waitForFunction(() => typeof document.getElementById("dl")?.onclick === "function");
    await noOverflow(page, `workflow ${width}`);
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download as Markdown" }).click();
    const download = await downloadEvent;
    assert.match(download.suggestedFilename(), /protocol\.md$/);
    assert.match(readFileSync(await download.path(), "utf8"), /ADMET/i);
    await page.getByRole("button", { name: "Copy protocol" }).click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /ADMET/i);
    await page.getByText("Wrong workflow? Choose another", { exact: true }).click();
    await page.getByRole("link", { name: "Synthesis planning", exact: true }).click();
    await page.getByRole("heading", { name: "Synthesis planning", exact: true }).waitFor();
    assert.match(await page.locator(".section-head").first().innerText(), /selected by you/);
    assert.equal(await page.getByText("Semantic routing was unavailable", { exact: false }).count(), 0);
    assert.equal(await page.getByRole("link", { name: "Suggest a tool or report an issue" }).getAttribute("href"),
      "https://github.com/yboulaamane/assayer/issues/new");
    if (process.env.ASSAYER_SCREENSHOTS) await page.screenshot({ path: `${process.env.ASSAYER_SCREENSHOTS}/workflow-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: navigation, theme, MIT filtering, drawer, empty search, workflow, download, copy, feedback`);
    await context.close();
  }

  const page = await browser.newPage();
  let requests = 0;
  await page.route("**/catalog.json", (route) => {
    requests++;
    return requests === 1 ? route.fulfill({ status: 503, body: "Unavailable" })
      : route.fulfill({ json: catalogue });
  });
  await page.goto(base);
  await page.getByRole("button", { name: "Try again" }).click();
  await page.locator(".stage-card").first().waitFor();
  assert.equal(requests, 2);
  console.log("PASS catalogue failure and retry recovery");
  assert.equal(await page.locator('meta[property="og:image"]').getAttribute("content"),
    "https://assayer.vercel.app/assets/social-preview.png");
  const preview = await page.request.get(`${base}/assets/social-preview.png`);
  assert.equal(preview.status(), 200);
  assert.match(preview.headers()["content-type"], /image\/png/);
  console.log("PASS social preview metadata and image response");

  // Hold each fixture until its loading stage is observable. This verifies
  // actual state changes without manufacturing delays in the production UI.
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const deferred = () => { let release; const promise = new Promise((r) => { release = r; }); return { promise, release }; };
    const routing = deferred();
    let target = deferred();
    const structures = deferred();
    await page.route("**/api/route", async (route) => {
      await routing.promise;
      await route.fulfill({ json: { intent: "hit-discovery", target: "EGFR", organism_taxid: 9606 } });
    });
    await page.route("https://rest.uniprot.org/**", async (route) => {
      await target.promise;
      await route.fulfill({ json: { results: [{ primaryAccession: "P00533", uniProtkbId: "EGFR_HUMAN",
        proteinDescription: { recommendedName: { fullName: { value: "Epidermal growth factor receptor" } } },
        genes: [{ geneName: { value: "EGFR" } }], organism: { scientificName: "Homo sapiens", taxonId: 9606 },
        sequence: { length: 1210 } }] } });
    });
    await page.route("https://search.rcsb.org/**", async (route) => {
      await structures.promise;
      await route.fulfill({ json: { result_set: ["1M17"], total_count: 1 } });
    });
    await page.route("https://data.rcsb.org/**", (route) => route.fulfill({ json: { data: { entries: [{
      rcsb_id: "1M17", struct: { title: "EGFR kinase with inhibitor" }, exptl: [{ method: "X-RAY DIFFRACTION" }],
      rcsb_entry_info: { resolution_combined: [2.6] }, refine: [{ ls_R_factor_R_free: 0.24 }],
      nonpolymer_entities: [{ nonpolymer_comp: { chem_comp: { id: "AQ4", name: "Erlotinib", formula_weight: 393 } } }],
      polymer_entities: [{ rcsb_entity_source_organism: [{ scientific_name: "Homo sapiens" }] }],
    }] } } }));
    await page.route("https://alphafold.ebi.ac.uk/**", (route) => route.fulfill({ json: [] }));
    await page.goto(`${base}/#/workflow?q=${encodeURIComponent("Find inhibitors of EGFR in human without MD")}`);
    await page.getByRole("heading", { name: "Finding your workflow" }).waitFor();
    await noOverflow(page, `routing animation ${width}`);
    assert.equal(await page.locator(".workflow-examples").getAttribute("open"), null);
    const loaderBox = await page.locator(".workflow-loading").boundingBox();
    assert.ok(loaderBox.y + loaderBox.height <= 900, "Loading progress is visible without scrolling");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.locator(".loading-orbit").evaluate((el) => getComputedStyle(el).animationName), "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    if (process.env.ASSAYER_SCREENSHOTS) await page.screenshot({ path: `${process.env.ASSAYER_SCREENSHOTS}/loading-${width}.png` });
    routing.release();
    await page.getByRole("heading", { name: "Getting to know your target" }).waitFor();
    assert.equal(await page.locator(".loading-phases .done").count(), 1);
    target.release();
    await page.getByRole("heading", { name: "Finding a structure to build on" }).waitFor();
    await noOverflow(page, `structure animation ${width}`);
    assert.equal(await page.locator(".loading-phases .done").count(), 2);
    structures.release();
    await page.locator(".struct-table").waitFor();
    await page.waitForFunction(() => typeof document.getElementById("dl")?.onclick === "function");
    assert.equal(await page.locator(".workflow-loading").count(), 0);
    assert.match(await page.locator(".struct-table").innerText(), /1M17/);
    await noOverflow(page, `structure table ${width}`);

    await page.getByRole("link", { name: "Stages", exact: true }).click();
    target = deferred();
    await page.getByRole("link", { name: "Plan a workflow", exact: true }).click();
    await page.getByRole("textbox", { name: "Research question" }).fill("Find inhibitors of EGFR in human");
    await page.getByRole("button", { name: "Plan it", exact: true }).click();
    await page.getByRole("heading", { name: "Getting to know your target" }).waitFor();
    await page.getByRole("link", { name: "Stages", exact: true }).click();
    const response = page.waitForResponse((r) => r.url().includes("rest.uniprot.org"));
    target.release();
    await response;
    await page.locator(".stage-card").first().waitFor();
    assert.equal(await page.locator("#plan").count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: loading stages, reduced motion, structure table and navigation during lookup (API fixtures)`);
    await context.close();
  }
} finally {
  await browser.close();
}
