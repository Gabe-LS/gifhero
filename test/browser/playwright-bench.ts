import { chromium } from "playwright";
import { join } from "path";

const VIDEO = process.argv[2] || "test/fixtures/videos/big-buck-bunny.mp4";
const ROOT = join(import.meta.dirname, "../..");
const videoPath = join(ROOT, VIDEO);

async function main() {
  console.log(`\nBenchmark: ${VIDEO}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[benchmark]") || text.includes("[gifhero") || text.includes("[gifski")) {
      console.log(text);
    }
  });

  await page.goto("http://localhost:3333/test/browser/");
  await page.waitForLoadState("networkidle");

  const fileInput = page.locator("#benchFile");
  await fileInput.setInputFiles(videoPath);

  await page.waitForTimeout(500);
  await page.click("#benchStart");

  // Wait for benchmark to complete (look for END marker in console)
  await page.waitForFunction(
    () => (window as any).__benchDone === true,
    { timeout: 300000 },
  ).catch(async () => {
    // Fallback: wait for the button to be re-enabled
    await page.waitForSelector("#benchStart:not([disabled])", { timeout: 300000 });
  });

  await page.waitForTimeout(1000);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
