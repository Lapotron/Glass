export function githubPagesSetup(
  repository: string | undefined,
  token: string | undefined,
  request?: (url: string, options: RequestInit) => Promise<Response>,
): Promise<{ enabled: boolean; message: string }>;
