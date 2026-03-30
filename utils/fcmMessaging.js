import admin from 'firebase-admin';
import { ensureFirebaseApp } from './firebaseAuth.js';

const MAX_MULTICAST = 500;

/**
 * Send FCM notification + data payload to device tokens.
 * Data values must be strings (FCM requirement).
 *
 * @param {string[]} tokens - FCM registration tokens
 * @param {{ title: string, body: string, data?: Record<string, string|number|boolean|null|undefined> }} payload
 * @returns {{ sent: number, failed: number, skipped: boolean, invalidTokens: string[] }}
 */
export async function sendFcmToTokens(tokens, { title, body, data = {} }) {
  const app = ensureFirebaseApp();
  if (!app) {
    console.warn('[FCM] Firebase not configured (FIREBASE_PROJECT_ID / service account); skipping push');
    return { sent: 0, failed: 0, skipped: true, invalidTokens: [] };
  }

  const unique = [...new Set((tokens || []).filter((t) => typeof t === 'string' && t.length > 0))];
  if (unique.length === 0) {
    return { sent: 0, failed: 0, skipped: false, invalidTokens: [] };
  }

  const dataStrings = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) dataStrings[k] = '';
    else dataStrings[k] = String(v);
  }

  const messaging = admin.messaging();
  let sent = 0;
  let failed = 0;
  const invalidTokens = [];

  const INVALID_CODES = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered'
  ]);

  const isRetryableError = (err) => {
    const code = err?.code || '';
    const msg = err?.message || '';
    // Retry for transient server/network failures.
    return (
      code.includes('messaging/internal-error') ||
      code.includes('messaging/server-unavailable') ||
      code.includes('messaging/service-unavailable') ||
      code.includes('messaging/unknown-error') ||
      msg.toLowerCase().includes('timeout') ||
      msg.toLowerCase().includes('ecconn') ||
      msg.toLowerCase().includes('econnreset') ||
      msg.toLowerCase().includes('temporar')
    );
  };

  for (let i = 0; i < unique.length; i += MAX_MULTICAST) {
    const chunk = unique.slice(i, i + MAX_MULTICAST);
    // Retry the whole chunk on transient server/network errors.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await messaging.sendEachForMulticast({
          tokens: chunk,
          // Match your payload requirement: priority high
          priority: 'high',
          notification: { title, body },
          data: dataStrings,
          android: { priority: 'high' },
          apns: {
            payload: {
              aps: {
                sound: 'default'
              }
            }
          }
        });

        sent += result.successCount;
        failed += result.failureCount;

        if (result.responses?.length) {
          result.responses.forEach((r, idx) => {
            const token = chunk[idx];
            if (!r.success) {
              const code = r.error?.code;
              console.warn('[FCM] Token send failed:', token?.slice(0, 20) + '...', code || r.error?.message);
              if (code && INVALID_CODES.has(code)) {
                invalidTokens.push(token);
              }
            }
          });
        }

        // Chunk succeeded (even if some tokens failed, we got per-token responses)
        break;
      } catch (error) {
        const retryable = attempt < 3 && isRetryableError(error);
        console.error(`[FCM] sendEachForMulticast error (attempt ${attempt}/3):`, error.message);
        if (!retryable) {
          failed += chunk.length;
          break;
        }
        const backoffMs = 300 * Math.pow(2, attempt - 1); // 300ms, 600ms, 1200ms
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  return { sent, failed, skipped: false, invalidTokens: [...new Set(invalidTokens)] };
}
