export interface LLMProvider {
  call(prompt: string): Promise<string>;
}

export class StubProvider implements LLMProvider {
  async call(_prompt: string): Promise<string> {
    return '[stub] LLM response placeholder';
  }
}
