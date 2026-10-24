import { z } from 'zod';
const https = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'Use an HTTPS URL');
export const projectSchema = z.object({
  id: z.string().regex(/^[\w-]{1,100}$/),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).default(''),
  technologies: z.array(z.string().trim().min(1).max(40)).max(24).default([]),
  status: z
    .enum(['exploring', 'active', 'maintained', 'complete', 'paused', 'archived'])
    .default('active'),
  visibility: z.enum(['draft', 'public']).default('draft'),
  image: z
    .string()
    .regex(/^$|^\/media\/[^?#]+$/)
    .default(''),
  imageAlt: z.string().max(300).default(''),
  links: z
    .array(z.object({ label: z.string().trim().min(1).max(40), url: https }))
    .max(8)
    .default([]),
  github: z
    .string()
    .regex(/^$|^[\w.-]+\/[\w.-]+$/)
    .default(''),
  updatedAt: z.string().default(''),
});
export const projectsSchema = z
  .object({
    version: z.literal(1).default(1),
    projects: z.array(projectSchema).max(500).default([]),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.projects.map((p) => p.id)).size !== value.projects.length)
      ctx.addIssue({ code: 'custom', path: ['projects'], message: 'Project IDs must be unique.' });
  });
export type Project = z.infer<typeof projectSchema>;
export type Projects = z.infer<typeof projectsSchema>;
export const emptyProjects = (): Projects => ({ version: 1, projects: [] });
export const projectStatusLabels: Record<Project['status'], string> = {
  exploring: 'Exploring',
  active: 'In development',
  maintained: 'Maintained',
  complete: 'Complete',
  paused: 'On hold',
  archived: 'Archived',
};
