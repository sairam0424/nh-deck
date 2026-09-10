import { Launcher } from "chrome-launcher";
import puppeteer from "puppeteer-core";

/**
 * Renders the given HTML to a PDF at outputPath using a locally-installed
 * Chrome/Chromium/Edge/Brave browser, detected via chrome-launcher.
 *
 * No Chromium is bundled or downloaded — if no local installation is found,
 * this throws a clear, descriptive Error rather than crashing with a raw
 * Puppeteer stack trace. An automatic download fallback is a planned but
 * not-yet-implemented feature.
 */
export async function exportToPdf(
  html: string,
  outputPath: string,
): Promise<void> {
  const installations = Launcher.getInstallations();

  if (!installations || installations.length === 0) {
    throw new Error(
      "No local Chrome, Chromium, Edge, or Brave installation was found. " +
        "nh-deck requires one of these browsers to be installed on this machine to export PDFs. " +
        "An automatic download fallback is a planned but not-yet-implemented feature.",
    );
  }

  // installations[0] is intentional, not a missing-selection-logic bug:
  // chrome-launcher's own README documents that "the first installation
  // returned from this method is used instead" when no explicit chromePath
  // is given, and getInstallations() returns paths in decreasing priority
  // order per platform. Do not add custom selection logic here.
  const executablePath = installations[0];

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.pdf({ path: outputPath, format: "A4", printBackground: true });
    await page.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to export PDF using ${executablePath}: ${message}`);
  } finally {
    await browser?.close();
  }
}
