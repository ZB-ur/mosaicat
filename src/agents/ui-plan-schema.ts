import { z } from 'zod';

export const UIPlanComponentSchema = z.object({
  name: z.string(),
  file: z.string(),
  preview: z.string(),
  purpose: z.string(),
  covers_features: z.array(z.string()),
  parent: z.string().nullable(),
  children: z.array(z.string()),
  props: z.array(z.string()),
  priority: z.number(),
});

export const UIPlanModuleSchema = z.object({
  name: z.string(),       // e.g. "atomic", "business", "pages"
  label: z.string(),      // e.g. "基础原子组件", "业务组件"
  components: z.array(z.string()), // component names in this module
});

export const UIPlanSchema = z.object({
  design_tokens: z.record(z.string(), z.string()).optional(),
  modules: z.array(UIPlanModuleSchema).optional(),
  components: z.array(UIPlanComponentSchema),
});

export type UIPlan = z.infer<typeof UIPlanSchema>;
export type UIPlanComponent = z.infer<typeof UIPlanComponentSchema>;
