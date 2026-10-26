import type { Repository } from '../shared/contracts.js';
import { validBasePath } from '../shared/public-path.js';

export type DeploymentInput = { target: 'github-pages'; baseUrl: string };
export type PublicDeployment = {
  target: 'cloudflare-pages' | 'github-pages';
  origin: string;
  basePath: string;
  baseUrl: string;
};

export function publicDeployment(origin: string, input?: DeploymentInput): PublicDeployment {
  if (!input)
    return { target: 'cloudflare-pages', origin, basePath: '', baseUrl: origin.replace(/\/$/, '') };
  const url = new URL(input.baseUrl);
  const basePath = url.pathname.replace(/\/$/, '');
  const rawPath = input.baseUrl.match(/^https:\/\/[^/]+(\/[^?#]*)?/i)?.[1]?.replace(/\/$/, '') || '';
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[\\\s]/.test(input.baseUrl) ||
    !validBasePath(rawPath) ||
    !validBasePath(basePath)
  )
    throw new Error('GitHub Pages needs an HTTPS base URL without credentials, query or fragment.');
  return { target: 'github-pages', origin: url.origin, basePath, baseUrl: url.origin + basePath };
}

/** Effective build settings never overwrite the author's notebook. */
export function deploymentModel(model: Repository, deployment: PublicDeployment): Repository {
  if (deployment.target !== 'github-pages') return model;
  return {
    ...model,
    site: {
      ...model.site,
      url: deployment.origin,
      mediaDelivery: { ...model.site.mediaDelivery, mode: 'pages' },
      integrations: {
        ...model.site.integrations,
        aca: { ...model.site.integrations.aca, enabled: false },
        analytics: {
          ...model.site.integrations.analytics,
          enabled:
            model.site.integrations.analytics.enabled &&
            model.site.integrations.analytics.mode !== 'managed',
        },
      },
    },
  };
}
