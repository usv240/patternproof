export const PUBLIC_DEMO_TOKEN = "demo-olive";

export function isPublicDemoToken(token: unknown): token is typeof PUBLIC_DEMO_TOKEN {
  return token === PUBLIC_DEMO_TOKEN;
}
