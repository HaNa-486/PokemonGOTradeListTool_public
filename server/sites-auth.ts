import type { Runtime } from './auth';

// Sites owns these routes; never implement them in this Worker or fetch/prefetch
// them from JavaScript. A top-level browser navigation starts/ends platform auth.
export const chatGPTSignInPath = '/signin-with-chatgpt?return_to=%2F';
export const chatGPTSignOutPath = '/signout-with-chatgpt?return_to=%2F';

export function chatGPTReady(env: Runtime): boolean {
  if (env.SITES_CHATGPT_AUTH !== 'enabled' || !env.APP_ORIGIN) return false;
  try {
    const url = new URL(env.APP_ORIGIN);
    return url.protocol === 'https:' && url.hostname.endsWith('.chatgpt.site')
      && !url.port && !url.username && !url.password && url.origin === env.APP_ORIGIN;
  } catch { return false; }
}

/**
 * Trust boundary: the Sites dispatcher authenticates the visitor and supplies
 * these headers (same contract as the official app/chatgpt-auth.ts helper).
 * Enable only on the managed Site, never on a standalone publicly reachable
 * Worker, Node server, or local preview. Host matching is defense in depth, not
 * proof of authentication. Live spoofed-header rejection is a deployment gate.
 * A Sites service/bypass credential is NOT a user identity.
 */
export function chatGPTSubject(req: Request, env: Runtime): string | null {
  if (!chatGPTReady(env) || new URL(req.url).origin !== env.APP_ORIGIN) return null;
  const subject = req.headers.get('oai-authenticated-user-id');
  const email = req.headers.get('oai-authenticated-user-email');
  // Treat the subject as opaque. Email is required by the official contract but
  // is never used as an account key, stored, or returned to circle members.
  if (!subject || !email || subject.length > 256 || email.length > 320
      || subject.trim() !== subject || /[\s,\x00-\x1f\x7f]/.test(subject)
      || /[\r\n,]/.test(email)) return null;
  return subject;
}
