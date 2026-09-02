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

  const executablePath = installations[0];
  const browser = await puppeteer.launch({ executablePath, headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({ path: outputPath, format: "A4", printBackground: true });
    await page.close();
  } finally {
    await browser.close();
  }
}
