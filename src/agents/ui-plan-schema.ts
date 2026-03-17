import { z } from 'zod';

export const UIPlanComponentSchema = z.object({
  name: z.string(),
  file: z.string(),
  preview: z.string(),
  purpose: z.string(),
  covers_flow: z.string(),
  parent: z.string().nullable(),
  children: z.array(z.string()),
  props: z.array(z.string()),
  priority: z.number(),
});

export const UIPlanSchema = z.object({
  design_tokens: z.record(z.string(), z.string()).optional(),
  components: z.array(UIPlanComponentSchema),
});

export type UIPlan = z.infer<typeof UIPlanSchema>;
export type UIPlanComponent = z.infer<typeof UIPlanComponentSchema>;
