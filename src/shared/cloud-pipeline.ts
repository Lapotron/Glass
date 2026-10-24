export type PipelineMode = 'studio' | 'publish' | 'service';
export const cloudMaintenancePath = (path: string) =>
  /^\/api\/(?:aca\/(?:deployment\/(?:setup|deploy)|rollback(?:\/review)?)|cloud-media(?:\/(?:health|review|cleanup|protection\/(?:check|apply)))?)$/.test(
    path.split('?')[0],
  );
/** A Git build can never infer publication from an earlier approved release. */
export function pipelineMode(
  build: string,
  job: { build_uuid: string | null; kind: string; state: string; request?: string } | null,
): PipelineMode {
  if (!build || job?.build_uuid !== build || !['queued', 'running'].includes(job.state))
    return 'studio';
  if (job.kind === 'publish') return 'publish';
  try {
    if (job.kind === 'api' && cloudMaintenancePath(JSON.parse(job.request || '{}').path || ''))
      return 'service';
  } catch {}
  return 'studio';
}
