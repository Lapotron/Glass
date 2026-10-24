declare module 'cloudflare:workers' {
  export const env: unknown;
}
declare module 'next/headers' {
  export function headers(): Promise<Headers>;
}
declare module 'next/navigation' {
  export function notFound(): never;
}
