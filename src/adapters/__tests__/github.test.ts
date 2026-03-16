import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIssues = {
  create: vi.fn(),
  createComment: vi.fn(),
  update: vi.fn(),
  addLabels: vi.fn(),
  removeLabel: vi.fn(),
  listComments: vi.fn(),
  get: vi.fn(),
};

vi.mock('@octokit/rest', () => ({
  Octokit: class MockOctokit {
    issues = mockIssues;
  },
}));

import { GitHubAdapter } from '../github.js';

describe('GitHubAdapter', () => {
  let adapter: GitHubAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GitHubAdapter({ token: 'test-token', owner: 'test-owner', repo: 'test-repo' });
  });

  it('should create an issue', async () => {
    mockIssues.create.mockResolvedValue({
      data: { number: 42, html_url: 'https://github.com/test-owner/test-repo/issues/42' },
    });

    const result = await adapter.createIssue({
      title: 'Test Issue',
      body: 'Test body',
      labels: ['bug'],
    });

    expect(result).toEqual({ number: 42, url: 'https://github.com/test-owner/test-repo/issues/42' });
    expect(mockIssues.create).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      title: 'Test Issue',
      body: 'Test body',
      labels: ['bug'],
    });
  });

  it('should add a comment', async () => {
    mockIssues.createComment.mockResolvedValue({ data: {} });

    await adapter.addComment(42, 'Test comment');

    expect(mockIssues.createComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
      body: 'Test comment',
    });
  });

  it('should close an issue', async () => {
    mockIssues.update.mockResolvedValue({ data: {} });

    await adapter.closeIssue(42);

    expect(mockIssues.update).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
      state: 'closed',
    });
  });

  it('should add labels', async () => {
    mockIssues.addLabels.mockResolvedValue({ data: {} });

    await adapter.addLabels(42, ['status:review-needed']);

    expect(mockIssues.addLabels).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
      labels: ['status:review-needed'],
    });
  });

  it('should remove a label', async () => {
    mockIssues.removeLabel.mockResolvedValue({ data: {} });

    await adapter.removeLabel(42, 'status:review-needed');

    expect(mockIssues.removeLabel).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
      name: 'status:review-needed',
    });
  });

  it('should get comments', async () => {
    mockIssues.listComments.mockResolvedValue({
      data: [
        {
          id: 1,
          body: '/approve',
          user: { login: 'testuser' },
          created_at: '2026-03-16T00:00:00Z',
        },
      ],
    });

    const comments = await adapter.getComments(42, '2026-03-15T00:00:00Z');

    expect(comments).toEqual([
      {
        id: 1,
        body: '/approve',
        author: 'testuser',
        createdAt: '2026-03-16T00:00:00Z',
      },
    ]);
    expect(mockIssues.listComments).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
      since: '2026-03-15T00:00:00Z',
    });
  });

  it('should get issue details', async () => {
    mockIssues.get.mockResolvedValue({
      data: {
        number: 42,
        title: 'Test Issue',
        body: 'Test body',
        state: 'open',
        labels: [{ name: 'bug' }, { name: 'status:review-needed' }],
        created_at: '2026-03-16T00:00:00Z',
        closed_at: null,
      },
    });

    const issue = await adapter.getIssue(42);

    expect(issue).toEqual({
      number: 42,
      title: 'Test Issue',
      body: 'Test body',
      state: 'open',
      labels: ['bug', 'status:review-needed'],
      createdAt: '2026-03-16T00:00:00Z',
      closedAt: undefined,
    });
  });
});
