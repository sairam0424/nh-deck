#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import open from "open";
import { generateHtml } from "./render.js";
import { startServer } from "./server.js";
import { exportToPdf } from "./pdfExport.js";

const program = new Command();

program
  .name("nh-deck")
  .description(
    "A local-first CLI for writing, presenting, and exporting Markdown-based slide decks.",
  )
  .version("0.1.0");

program
  .command("render <file>")
  .description("Render a Markdown deck and serve it locally.")
  .option("--no-open", "do not open the deck in the default browser")
  .option("--port <n>", "port to listen on (default: OS-assigned)")
  .action(async (file: string, options: { open: boolean; port?: string }) => {
    const markdown = readFileSync(file, "utf8");
    const html = generateHtml(markdown, file);
    const port = options.port !== undefined ? Number(options.port) : undefined;
    const { url } = await startServer(html, port);

    process.stdout.write(`nh-deck serving ${file} at ${url}\n`);

    if (options.open) {
      await open(url);
    }
  });

program
  .command("pdf <file> [output]")
  .description("Export a Markdown deck to PDF.")
  .action(async (file: string, output?: string) => {
    const markdown = readFileSync(file, "utf8");
    const html = generateHtml(markdown, file);
    const outputPath = output ?? file.replace(/\.md$/, ".pdf");

    try {
      await exportToPdf(html, outputPath);
      process.stdout.write(`Wrote PDF to ${outputPath}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`nh-deck: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.parse();
