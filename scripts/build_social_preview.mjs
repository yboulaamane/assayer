// Render the editable HTML design as the PNG used by social crawlers.
// Requires Playwright and its Chromium browser; no dependency is shipped to users.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(readFileSync(new URL("./social-preview.html", import.meta.url), "utf8"));
  await page.screenshot({ path: fileURLToPath(new URL("../web/assets/social-preview.png", import.meta.url)) });
} finally {
  await browser.close();
}
