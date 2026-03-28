import { z } from 'zod';

// Implementation status for individual code files (per D-04)
export const ImplementationStatusSchema = z.enum(['stub', 'partial', 'complete']);
export type ImplementationStatus = z.infer<typeof ImplementationStatusSchema>;

// Quality gate data embedded in each stage's manifest (per D-07)
export const QualityGateSchema = z.object({
  stub_count: z.number(),
  partial_count: z.number(),
  complete_count: z.number(),
  coverage_gaps: z.array(z.string()), // F-NNN IDs not covered
  blocked: z.boolean(),
});
export type QualityGate = z.infer<typeof QualityGateSchema>;

// AST analysis result types
export type StubIssueType = 'empty-body' | 'return-null' | 'empty-jsx' | 'todo-fixme';

export interface StubIssue {
  type: StubIssueType;
  line: number;
  detail: string;
}

export interface FileAnalysis {
  filePath: string;
  issues: StubIssue[];
  status: ImplementationStatus;
  functionCount: number;
  stubFunctionCount: number;
  hasTodoFixme: boolean;
}
