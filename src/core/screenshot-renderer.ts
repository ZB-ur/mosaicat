import fs from 'node:fs';
import path from 'node:path';

export interface ScreenshotResult {
  componentName: string;
  screenshotPath: string;
}

/**
 * Renders React+Tailwind component files as PNG screenshots using Playwright.
 * Extracts JSX return block, converts className→class, wraps in HTML with Tailwind CDN.
 *
 * @param componentFiles - Relative paths within artifactsDir (e.g., "components/AuthForm.tsx")
 * @param artifactsDir - Root artifacts directory (e.g., ".mosaic/artifacts")
 * @returns Array of screenshot results with component name and output path
 */
export async function renderScreenshots(
  componentFiles: string[],
  artifactsDir: string,
): Promise<ScreenshotResult[]> {
  // Dynamic import so Playwright is only loaded when actually rendering
  const { chromium } = await import('playwright');

  const browser = await chromium.launch();
  const results: ScreenshotResult[] = [];

  try {
    for (const file of componentFiles) {
      const name = path.basename(file, '.tsx');
      const fullPath = path.join(artifactsDir, file);

      if (!fs.existsSync(fullPath)) continue;

      const componentContent = fs.readFileSync(fullPath, 'utf-8');
      const html = buildComponentHTML(name, componentContent);

      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.setContent(html, { waitUntil: 'networkidle' });

      const screenshotDir = path.join(artifactsDir, 'screenshots');
      fs.mkdirSync(screenshotDir, { recursive: true });

      const screenshotPath = `screenshots/${name}.png`;
      await page.screenshot({
        path: path.join(artifactsDir, screenshotPath),
        fullPage: true,
      });

      await page.close();
      results.push({ componentName: name, screenshotPath });
    }
  } finally {
    await browser.close();
  }

  return results;
}

/**
 * Builds a self-contained HTML page from a TSX component.
 * Extracts JSX from the return statement, converts className to class,
 * and wraps in HTML with Tailwind CSS CDN.
 */
export function buildComponentHTML(name: string, tsxContent: string): string {
  // Try to extract the JSX return block
  // Match: return ( ... ) or return <...>
  const returnParenMatch = tsxContent.match(/return\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*\}/);
  const returnDirectMatch = tsxContent.match(/return\s*(<[\s\S]*?>[\s\S]*?<\/[\s\S]*?>)\s*;?\s*\}/);

  let jsx = returnParenMatch?.[1] ?? returnDirectMatch?.[1];

  if (!jsx) {
    // Fallback: use a placeholder
    jsx = `<div style="padding: 16px; color: #666;">Component "${name}" could not be rendered</div>`;
  }

  // Convert JSX className to HTML class
  const html = jsx.replace(/className=/g, 'class=');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>body { margin: 0; padding: 16px; background: white; font-family: system-ui, sans-serif; }</style>
</head>
<body>
${html}
</body>
</html>`;
}
