import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SecurityAuditorAgent } from '../security-auditor.js';

describe('SecurityAuditorAgent', () => {
  const testCodeDir = '.mosaic/test-code-dir';

  beforeEach(() => {
    if (fs.existsSync(testCodeDir)) {
      fs.rmSync(testCodeDir, { recursive: true });
    }
    fs.mkdirSync(testCodeDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testCodeDir)) {
      fs.rmSync(testCodeDir, { recursive: true });
    }
  });

  describe('SEC-01: .env file handling', () => {
    it('does NOT include .env extension in scan file list', () => {
      // Read the source file to verify .env is not in the extension allowlist
      const source = fs.readFileSync(
        path.resolve('src/agents/security-auditor.ts'),
        'utf-8'
      );
      // Find the line with the extension array in scanFilesForPatterns
      const extArrayMatch = source.match(
        /\['.ts',\s*'.tsx',\s*'.js',\s*'.jsx',\s*'.json',\s*'.yaml',\s*'.yml'(?:,\s*'.env')?\]/
      );
      expect(extArrayMatch).not.toBeNull();
      // .env should NOT be in the matched array
      expect(extArrayMatch![0]).not.toContain('.env');
    });

    it('does NOT read .env file contents during pattern scan', () => {
      // Create a .env file with a secret pattern
      fs.writeFileSync(
        path.join(testCodeDir, '.env'),
        'api_key = "sk_live_1234567890abcdefghij"\n'
      );

      // Also create a .ts file with a secret pattern for comparison
      fs.writeFileSync(
        path.join(testCodeDir, 'config.ts'),
        'const token = "sk_live_1234567890abcdefghij";\n'
      );

      // Use the private method via prototype access
      const agent = Object.create(SecurityAuditorAgent.prototype);
      const findings: string[] = [];
      const patterns = [
        /(?:api[_-]?key|apikey)\s*[=:]\s*['"][a-zA-Z0-9]{20,}['"]/gi,
        /(?:token)\s*[=:]\s*['"][a-zA-Z0-9_\-.]{20,}['"]/gi,
      ];

      // Call the private method directly
      (agent as { scanFilesForPatterns: (dir: string, patterns: RegExp[], findings: string[]) => void })
        .scanFilesForPatterns(testCodeDir, patterns, findings);

      // Should find the token in config.ts but NOT the api_key in .env
      const envFindings = findings.filter(f => f.includes('.env'));
      expect(envFindings.length).toBe(0);

      // config.ts should have findings
      const tsFindings = findings.filter(f => f.includes('config.ts'));
      expect(tsFindings.length).toBeGreaterThan(0);
    });

    it('checkEnvFileExistence detects .env files without reading contents', () => {
      // Create .env files
      fs.writeFileSync(path.join(testCodeDir, '.env'), 'SECRET=value\n');
      fs.writeFileSync(path.join(testCodeDir, '.env.local'), 'LOCAL_SECRET=value\n');

      // Create a subdirectory with another .env
      const subDir = path.join(testCodeDir, 'config');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, '.env.production'), 'PROD_SECRET=value\n');

      // Call the private method directly
      const agent = Object.create(SecurityAuditorAgent.prototype);
      const envFiles = (agent as { checkEnvFileExistence: (dir: string) => string[] })
        .checkEnvFileExistence(testCodeDir);

      expect(envFiles).toContain('.env');
      expect(envFiles).toContain('.env.local');
      expect(envFiles).toContain(path.join('config', '.env.production'));
      expect(envFiles.length).toBe(3);
    });

    it('checkEnvFileExistence skips node_modules and .git', () => {
      // Create .env in node_modules (should be ignored)
      const nmDir = path.join(testCodeDir, 'node_modules', 'some-pkg');
      fs.mkdirSync(nmDir, { recursive: true });
      fs.writeFileSync(path.join(nmDir, '.env'), 'IGNORED=true\n');

      // Create .env in .git (should be ignored)
      const gitDir = path.join(testCodeDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });
      fs.writeFileSync(path.join(gitDir, '.env'), 'IGNORED=true\n');

      // Create a real .env
      fs.writeFileSync(path.join(testCodeDir, '.env'), 'REAL=true\n');

      const agent = Object.create(SecurityAuditorAgent.prototype);
      const envFiles = (agent as { checkEnvFileExistence: (dir: string) => string[] })
        .checkEnvFileExistence(testCodeDir);

      expect(envFiles).toEqual(['.env']);
    });
  });
});
