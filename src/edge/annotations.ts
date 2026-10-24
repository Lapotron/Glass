import { annotationReader, type AnnotationConfig } from '../shared/annotations.js';
type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };
const read = annotationReader();
let configuration: { until: number; value: Promise<AnnotationConfig> } | undefined;
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/annotations/')) return env.ASSETS.fetch(request);
    if (!configuration || configuration.until < Date.now())
      configuration = {
        until: Date.now() + 60000,
        value: env.ASSETS.fetch(new Request(new URL('/assets/annotation-config.json', url))).then(
          async (response) => {
            if (!response.ok) throw new Error('Configuration unavailable.');
            return response.json() as Promise<AnnotationConfig>;
          },
        ),
      };
    try {
      return await read(request, await configuration.value);
    } catch {
      configuration = undefined;
      return Response.json({ error: 'Annotations are unavailable.' }, { status: 503 });
    }
  },
};
