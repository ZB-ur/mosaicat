import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  GitPlatformAdapter,
  CreateIssueParams,
  IssueComment,
  IssueDetails,
  PRRef,
  GitRef,
  GitBlob,
  GitTreeEntry,
  GitTree,
  GitCommit,
} from '../../adapters/types.js';
import { GitPublisher } from '../git-publisher.js';
import fs from 'node:fs';

// Mock adapter that records all API calls
class MockGitAdapter implements GitPlatformAdapter {
  calls: Array<{ method: string; args: unknown[] }> = [];

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }

  async createIssue(_params: CreateIssueParams) {
    this.record('createIssue', _params);
    return { number: 1, url: 'https://example.com/issues/1' };
  }
  async addComment(n: number, body: string) { this.record('addComment', n, body); }
  async closeIssue(n: number) { this.record('closeIssue', n); }
  async addLabels(n: number, labels: string[]) { this.record('addLabels', n, labels); }
  async removeLabel(n: number, label: string) { this.record('removeLabel', n, label); }
  async getComments(_n: number, _since?: string): Promise<IssueComment[]> { return []; }
  async getIssue(n: number): Promise<IssueDetails> {
    return { number: n, title: '', body: '', state: 'open', labels: [], createdAt: '' };
  }

  async createPR(params: { title: string; body: string; head: string; base?: string; draft?: boolean }): Promise<PRRef> {
    this.record('createPR', params);
    return { number: 42, url: 'https://example.com/pulls/42', branch: params.head };
  }
  async markPRReady(n: number) { this.record('markPRReady', n); }

  // Git Data API
  async getRef(ref: string): Promise<GitRef> {
    this.record('getRef', ref);
    return { ref: `refs/${ref}`, sha: 'main-sha-abc' };
  }
  async createRef(ref: string, sha: string): Promise<GitRef> {
    this.record('createRef', ref, sha);
    return { ref, sha };
  }
  async updateRef(ref: string, sha: string): Promise<GitRef> {
    this.record('updateRef', ref, sha);
    return { ref, sha };
  }
  async createBlob(content: string, encoding: 'utf-8' | 'base64'): Promise<GitBlob> {
    this.record('createBlob', content.slice(0, 20), encoding);
    return { sha: `blob-${this.calls.length}` };
  }
  async createTree(entries: GitTreeEntry[], baseTreeSha?: string): Promise<GitTree> {
    this.record('createTree', entries, baseTreeSha);
    return { sha: 'new-tree-sha' };
  }
  async createCommit(message: string, treeSha: string, parentShas: string[]): Promise<GitCommit> {
    this.record('createCommit', message, treeSha, parentShas);
    return { sha: 'new-commit-sha', treeSha };
  }
  async getCommit(sha: string): Promise<GitCommit> {
    this.record('getCommit', sha);
    return { sha, treeSha: 'parent-tree-sha' };
  }
  async createFileContent(filePath: string, content: string, message: string): Promise<{ sha: string }> {
    this.record('createFileContent', filePath, content, message);
    return { sha: 'init-commit-sha' };
  }
}

describe('GitPublisher (API mode)', () => {
  let adapter: MockGitAdapter;
  let publisher: GitPublisher;

  beforeEach(() => {
    adapter = new MockGitAdapter();
    publisher = new GitPublisher(adapter);
  });

  describe('init', () => {
    it('should create branch via API and Draft PR', async () => {
      const branch = await publisher.init('run-12345', 'Test pipeline');

      expect(branch).toBe('mosaicat/run-12345');

      // Should call getRef to get main HEAD
      const getRefCall = adapter.calls.find((c) => c.method === 'getRef');
      expect(getRefCall).toBeDefined();
      expect(getRefCall!.args[0]).toBe('heads/main');

      // Should create branch ref
      const createRefCall = adapter.calls.find((c) => c.method === 'createRef');
      expect(createRefCall).toBeDefined();
      expect(createRefCall!.args[0]).toBe('refs/heads/mosaicat/run-12345');
      expect(createRefCall!.args[1]).toBe('main-sha-abc');

      // Should create Draft PR
      const createPRCall = adapter.calls.find((c) => c.method === 'createPR');
      expect(createPRCall).toBeDefined();
      expect((createPRCall!.args[0] as Record<string, unknown>).draft).toBe(true);
      expect((createPRCall!.args[0] as Record<string, unknown>).head).toBe('mosaicat/run-12345');
    });

    it('should NOT call any local git commands', async () => {
      // This is the key behavioral change — no execFileSync('git', ...)
      await publisher.init('run-99999', 'No local git');

      // Verify only API methods were called
      const methods = adapter.calls.map((c) => c.method);
      expect(methods).toEqual(['getRef', 'createRef', 'createPR']);
    });
  });

  describe('init with empty repo', () => {
    it('should bootstrap empty repo via Contents API then create branch', async () => {
      // Override getRef to throw on first call (simulating 409 empty repo)
      let getRefCallCount = 0;
      adapter.getRef = async (ref: string) => {
        getRefCallCount++;
        if (getRefCallCount === 1) {
          throw new Error('Git Repository is empty.');
        }
        // After bootstrap, getRef works
        adapter.calls.push({ method: 'getRef', args: [ref] });
        return { ref: `refs/${ref}`, sha: 'init-commit-sha' };
      };

      const branch = await publisher.init('run-empty', 'Empty repo test');

      expect(branch).toBe('mosaicat/run-empty');

      const methods = adapter.calls.map((c) => c.method);
      // Should: createFileContent (bootstrap) → createRef (branch) → createPR
      expect(methods).toEqual(['createFileContent', 'createRef', 'createPR']);

      // createFileContent should create README.md
      const fileCall = adapter.calls.find((c) => c.method === 'createFileContent');
      expect(fileCall!.args[0]).toBe('README.md');

      // createRef should use the SHA from createFileContent
      const createRefCall = adapter.calls.find((c) => c.method === 'createRef');
      expect(createRefCall!.args[0]).toBe('refs/heads/mosaicat/run-empty');
      expect(createRefCall!.args[1]).toBe('init-commit-sha');
    });
  });

  describe('commitStage', () => {
    beforeEach(async () => {
      await publisher.init('run-12345', 'Test');
      adapter.calls = []; // reset to track only commitStage calls
    });

    it('should upload files as blobs and create commit via API', async () => {
      // Create a temp file to commit
      const tmpFile = '/tmp/mosaicat-test-artifact.txt';
      fs.writeFileSync(tmpFile, 'hello world');

      try {
        await publisher.commitStage('researcher', [tmpFile], 10);

        const methods = adapter.calls.map((c) => c.method);
        expect(methods).toEqual([
          'createBlob',   // upload file content
          'getCommit',    // get parent tree SHA
          'createTree',   // create new tree
          'createCommit', // create commit
          'updateRef',    // update branch ref
        ]);

        // Verify commit message includes issue ref
        const commitCall = adapter.calls.find((c) => c.method === 'createCommit');
        expect(commitCall!.args[0]).toContain('researcher');
        expect(commitCall!.args[0]).toContain('#10');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('should skip commit when no files exist', async () => {
      await publisher.commitStage('researcher', ['/nonexistent/file.txt']);

      // No API calls since no files could be read
      expect(adapter.calls).toHaveLength(0);
    });

    it('should skip missing files but commit existing ones', async () => {
      const tmpFile = '/tmp/mosaicat-test-existing.txt';
      fs.writeFileSync(tmpFile, 'exists');

      try {
        await publisher.commitStage('ux_designer', ['/nonexistent.txt', tmpFile]);

        // Should have created exactly 1 blob (for the existing file)
        const blobCalls = adapter.calls.filter((c) => c.method === 'createBlob');
        expect(blobCalls).toHaveLength(1);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('publish', () => {
    it('should add comment and mark PR ready', async () => {
      await publisher.init('run-12345', 'Test');
      adapter.calls = [];

      const result = await publisher.publish('## PR Body');

      expect(result).not.toBeNull();
      expect(result!.number).toBe(42);

      const methods = adapter.calls.map((c) => c.method);
      expect(methods).toEqual(['addComment', 'markPRReady']);
    });

    it('should return null if init was not called', async () => {
      const result = await publisher.publish('## PR Body');
      expect(result).toBeNull();
    });
  });
});
