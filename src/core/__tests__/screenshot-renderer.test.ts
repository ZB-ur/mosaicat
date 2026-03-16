import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildComponentHTML, renderScreenshots } from '../screenshot-renderer.js';

const TEST_DIR = '.mosaic/test-screenshots';

describe('screenshot-renderer', () => {
  describe('buildComponentHTML', () => {
    it('should extract JSX from return(...) and convert className to class', () => {
      const tsx = `export default function TestComp() {
  return (
    <div className="p-4 bg-blue-500">
      <h1 className="text-xl">Hello</h1>
    </div>
  );
}`;
      const html = buildComponentHTML('TestComp', tsx);
      expect(html).toContain('class="p-4 bg-blue-500"');
      expect(html).toContain('class="text-xl"');
      expect(html).not.toContain('className');
      expect(html).toContain('tailwindcss');
    });

    it('should handle component without return parentheses', () => {
      const tsx = `export default function Bare() {
  return <div className="m-2">bare</div>;
}`;
      const html = buildComponentHTML('Bare', tsx);
      expect(html).toContain('class="m-2"');
    });

    it('should show fallback for unextractable component', () => {
      const html = buildComponentHTML('Bad', 'const x = 1;');
      expect(html).toContain('could not be rendered');
    });
  });

  describe('renderScreenshots', () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(TEST_DIR, 'components'), { recursive: true });
    });

    afterEach(() => {
      if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true });
      }
    });

    it('should render a component to a PNG screenshot', async () => {
      const tsx = `export default function Card() {
  return (
    <div className="p-6 max-w-sm mx-auto bg-white rounded-xl shadow-lg">
      <h2 className="text-xl font-bold text-gray-900">Card Title</h2>
      <p className="text-gray-500 mt-2">Card description text</p>
    </div>
  );
}`;
      fs.writeFileSync(path.join(TEST_DIR, 'components/Card.tsx'), tsx);

      const results = await renderScreenshots(['components/Card.tsx'], TEST_DIR);

      expect(results).toHaveLength(1);
      expect(results[0].componentName).toBe('Card');
      expect(results[0].screenshotPath).toBe('screenshots/Card.png');

      // PNG file should exist and have non-zero size
      const pngPath = path.join(TEST_DIR, 'screenshots/Card.png');
      expect(fs.existsSync(pngPath)).toBe(true);
      const stat = fs.statSync(pngPath);
      expect(stat.size).toBeGreaterThan(0);
    }, 30000);

    it('should render multiple components', async () => {
      fs.writeFileSync(
        path.join(TEST_DIR, 'components/A.tsx'),
        'export default function A() { return (<div className="p-2">A</div>); }'
      );
      fs.writeFileSync(
        path.join(TEST_DIR, 'components/B.tsx'),
        'export default function B() { return (<div className="p-2">B</div>); }'
      );

      const results = await renderScreenshots(
        ['components/A.tsx', 'components/B.tsx'],
        TEST_DIR
      );

      expect(results).toHaveLength(2);
      expect(fs.existsSync(path.join(TEST_DIR, 'screenshots/A.png'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_DIR, 'screenshots/B.png'))).toBe(true);
    }, 30000);

    it('should skip missing component files', async () => {
      const results = await renderScreenshots(
        ['components/DoesNotExist.tsx'],
        TEST_DIR
      );

      expect(results).toHaveLength(0);
    }, 30000);
  });
});
