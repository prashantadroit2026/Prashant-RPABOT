#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs");
const publicDocsDir = join(root, "public", "docs");
mkdirSync(publicDocsDir, { recursive: true });

const files = [
  { md: join(docsDir, "DATABASE.md"), pdf: join(docsDir, "DATABASE.pdf"), title: "Database Design — Procurement Hub" },
  { md: join(docsDir, "API.md"), pdf: join(docsDir, "API.pdf"), title: "API Endpoints — Procurement Hub" },
];

// Combined
const combinedPdf = join(docsDir, "Procurement-Hub-Docs.pdf");
const combinedTitle = "Procurement Hub — Complete Documentation";

marked.setOptions({
  gfm: true,
  breaks: false,
  smartypants: true,
});

function mdToHtml(md, title) {
  const htmlBody = marked.parse(md);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
  :root { --ink:#1c1916; --muted:#6f675c; --line:#ddd6c8; --brass:#6e470e; --paper:#fbfaf6; --surface:#f7f4ec; --ok:#1d6b3f; --wait:#9a6700; --stop:#a61b14; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif; color: var(--ink); line-height: 1.6; max-width: 780px; margin: 0 auto; padding: 32px 28px 40px; font-size: 11.5pt; background: white; }
  h1 { font-size: 22pt; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 6px; color: var(--ink); border-bottom: 2px solid var(--line); padding-bottom: 10px; }
  h1 + blockquote { border-left: 3px solid var(--brass); margin: 12px 0 18px; padding: 8px 14px; background: var(--surface); color: var(--muted); font-size: 9.5pt; }
  h2 { font-size: 14pt; font-weight: 700; margin: 28px 0 8px; color: var(--brass); border-bottom: 1px solid var(--line); padding-bottom: 6px; }
  h3 { font-size: 11pt; font-weight: 600; margin: 18px 0 6px; color: var(--ink); }
  p { margin: 8px 0; font-size: 10.5pt; color: #2a2520; }
  a { color: var(--brass); text-decoration: none; }
  code { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 9pt; background: var(--surface); padding: 1px 5px; border-radius: 4px; }
  pre { background: #1c1916; color: #f3f0e8; padding: 14px 16px; border-radius: 8px; overflow-x: auto; font-size: 8.5pt; line-height: 1.5; margin: 12px 0; }
  pre code { background: transparent; color: inherit; padding: 0; font-size: inherit; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9.5pt; }
  th { text-align: left; background: var(--surface); color: var(--muted); font-size: 8pt; text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 10px; border: 1px solid var(--line); }
  td { padding: 8px 10px; border: 1px solid var(--line); vertical-align: top; }
  tr:nth-child(even) td { background: #fcfaf7; }
  blockquote { margin: 12px 0; padding: 8px 14px; background: var(--surface); border-left: 3px solid var(--line); color: var(--muted); }
  ul, ol { margin: 8px 0 8px 22px; padding: 0; }
  li { margin: 3px 0; font-size: 10pt; }
  hr { border: none; border-top: 1px solid var(--line); margin: 22px 0; }
  .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid var(--ink); padding-bottom: 12px; margin-bottom: 18px; }
  .header-left { display: flex; align-items: center; gap: 10px; }
  .logo { width: 36px; height: 36px; background: var(--brass); color: white; display: flex; align-items: center; justify-content: center; border-radius: 8px; font-weight: 700; font-size: 14pt; }
  .header h1 { border: none; margin: 0; padding: 0; font-size: 13pt; }
  .header p { margin: 0; font-size: 8pt; color: var(--muted); }
  .badge { display: inline-block; background: var(--brass); color: white; font-size: 7pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 7px; border-radius: 999px; }
  .footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid var(--line); font-size: 7.5pt; color: var(--muted); display: flex; justify-content: space-between; }
  .page-break { page-break-before: always; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <div class="logo">◈</div>
      <div>
        <h1 style="font-size:11pt; margin:0; border:none; padding:0;">Procurement Hub</h1>
        <p>Bot Dashboard — ${title.includes("Database") ? "Database" : title.includes("API") ? "API" : "Documentation"} • v1.0 • 2026-09-09</p>
      </div>
    </div>
    <span class="badge">PDF</span>
  </div>
  ${htmlBody}
  <div class="footer">
    <span>Procurement Hub • Bot Dashboard • Generated ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
    <span>http://localhost:8080/system • /api/openapi.json</span>
  </div>
</body>
</html>`;
}

async function generateOne(mdPath, pdfPath, title) {
  const md = readFileSync(mdPath, "utf8");
  const html = mdToHtml(md, title);
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle" });
  // Ensure fonts loaded
  await page.waitForTimeout(800);
  await page.pdf({
    path: pdfPath,
    format: "A4",
    margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `<span></span>`,
    footerTemplate: `<div style="width:100%; font-size:7px; color:#6f675c; padding:0 16mm; display:flex; justify-content:space-between;"><span>Procurement Hub — ${title.replace(/"/g, '&quot;')}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
  });
  await browser.close();
  console.log(`✓ ${pdfPath} (${(readFileSync(pdfPath).length / 1024).toFixed(1)} KB)`);
}

async function main() {
  for (const f of files) {
    await generateOne(f.md, f.pdf, f.title);
    // also copy to public/docs
    const pubPdf = join(publicDocsDir, f.pdf.split("/").pop());
    writeFileSync(pubPdf, readFileSync(f.pdf));
    console.log(`  → ${pubPdf}`);
  }
  // Combined
  const combinedMd = files.map(f => readFileSync(f.md, "utf8")).join("\n\n---\n\n<div class=\"page-break\"></div>\n\n");
  const combinedHtml = mdToHtml(combinedMd, combinedTitle);
  {
    const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage();
    await page.setContent(combinedHtml, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.pdf({
      path: combinedPdf,
      format: "A4",
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<span></span>`,
      footerTemplate: `<div style="width:100%; font-size:7px; color:#6f675c; padding:0 16mm; display:flex; justify-content:space-between;"><span>Procurement Hub — Complete Docs</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    });
    await browser.close();
    console.log(`✓ ${combinedPdf} (${(readFileSync(combinedPdf).length / 1024).toFixed(1)} KB)`);
    const pubCombined = join(publicDocsDir, "Procurement-Hub-Docs.pdf");
    writeFileSync(pubCombined, readFileSync(combinedPdf));
    console.log(`  → ${pubCombined}`);
  }
  console.log("\nAll PDFs generated.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
