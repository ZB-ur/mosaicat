import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Anthropic SDK before importing the provider
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
      constructor() {}
    },
    __mockCreate: mockCreate,
  };
});

import { AnthropicSDKProvider } from '../anthropic-sdk.js';

// Get access to the mock
async function getMockCreate() {
  const mod = await import('@anthropic-ai/sdk') as any;
  return mod.__mockCreate as ReturnType<typeof vi.fn>;
}

describe('AnthropicSDKProvider', () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockCreate = await getMockCreate();
    mockCreate.mockReset();
  });

  it('should call messages.create with correct parameters', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello world' }],
    });

    const provider = new AnthropicSDKProvider('test-key');
    const result = await provider.call('Say hello');

    expect(result).toBe('Hello world');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Say hello' }],
        max_tokens: 8192,
      })
    );
  });

  it('should pass system prompt as native system parameter', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'I am a researcher.' }],
    });

    const provider = new AnthropicSDKProvider('test-key');
    await provider.call('Analyze market', { systemPrompt: 'You are a researcher.' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are a researcher.',
        messages: [{ role: 'user', content: 'Analyze market' }],
      })
    );
  });

  it('should omit system field when no system prompt provided', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'response' }],
    });

    const provider = new AnthropicSDKProvider('test-key');
    await provider.call('Hello');

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('system');
  });

  it('should concatenate multiple text blocks', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'text', text: 'Part 1' },
        { type: 'text', text: ' Part 2' },
      ],
    });

    const provider = new AnthropicSDKProvider('test-key');
    const result = await provider.call('Hello');

    expect(result).toBe('Part 1 Part 2');
  });

  it('should filter out non-text blocks', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', id: 'x', name: 'y', input: {} },
        { type: 'text', text: ' World' },
      ],
    });

    const provider = new AnthropicSDKProvider('test-key');
    const result = await provider.call('Hello');

    expect(result).toBe('Hello World');
  });

  it('should propagate API errors', async () => {
    mockCreate.mockRejectedValue(new Error('Rate limit exceeded'));

    const provider = new AnthropicSDKProvider('test-key');
    await expect(provider.call('Hello')).rejects.toThrow('Rate limit exceeded');
  });

  it('should use custom model when provided', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const provider = new AnthropicSDKProvider('test-key', 'claude-opus-4-20250514');
    await provider.call('Hello');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-20250514',
      })
    );
  });
});
