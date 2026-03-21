import { z } from 'zod';

export const CodePlanModuleSchema = z.object({
  name: z.string(),
  description: z.string(),
  files: z.array(z.string()),
  dependencies: z.array(z.string()),
  covers_tasks: z.array(z.string()),
  covers_features: z.array(z.string()),
  priority: z.number(),
});

export const CodePlanSchema = z.object({
  project_name: z.string(),
  tech_stack: z.object({
    language: z.string(),
    framework: z.string(),
    build_tool: z.string(),
  }),
  commands: z.object({
    setupCommand: z.string(),
    verifyCommand: z.string(),
    buildCommand: z.string(),
  }),
  modules: z.array(CodePlanModuleSchema),
});

export type CodePlan = z.infer<typeof CodePlanSchema>;
export type CodePlanModule = z.infer<typeof CodePlanModuleSchema>;
