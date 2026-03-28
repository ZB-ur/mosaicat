import { ToolUseAgent } from './tool-use-agent.js';
import type { ToolUseOutputSpec } from './tool-use-agent.js';

export class ResearcherAgent extends ToolUseAgent {
  getToolUseSpec(): ToolUseOutputSpec {
    return {
      artifacts: ['research.md'],
      manifest: 'research.manifest.json',
    };
  }

  protected parseManifest(finalText: string): unknown | undefined {
    // Look for JSON manifest block delimited by ```json ... ```
    const jsonMatch = finalText.match(/```json\s*\n([\s\S]*?)\n\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
