import admin from 'firebase-admin';
import { ensureFirebaseApp } from './firebaseAuth.js';

const MAX_MULTICAST = 500;

/**
 * Send FCM notification + data payload to device tokens.
 * Data values must be strings (FCM requirement).
 *
 * @param {string[]} tokens - FCM registration tokens
 * @param {{ title: string, body: string, data?: Record<string, string|number|boolean|null|undefined> }} payload
 * @returns {{ sent: number, failed: number, skipped: boolean }}
 */
export async function sendFcmToTokens(tokens, { title, body, data = {} }) {
  const app = ensureFirebaseApp();
  if (!app) {
    console.warn('[FCM] Firebase not configured (FIREBASE_PROJECT_ID / service account); skipping push');
    return { sent: 0, failed: 0, skipped: true };
  }

  const unique = [...new Set((tokens || []).filter((t) => typeof t === 'string' && t.length > 0))];
  if (unique.length === 0) {
    return { sent: 0, failed: 0, skipped: false };
  }

  const dataStrings = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) dataStrings[k] = '';
    else dataStrings[k] = String(v);
  }

  const messaging = admin.messaging();
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < unique.length; i += MAX_MULTICAST) {
    const chunk = unique.slice(i, i + MAX_MULTICAST);
    try {
      const result = await messaging.sendEachForMulticast({
        tokens: chunk,
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
          if (!r.success && r.error?.code) {
            console.warn('[FCM] Token send failed:', chunk[idx]?.slice(0, 20) + '...', r.error.code);
          }
        });
      }
    } catch (error) {
      console.error('[FCM] sendEachForMulticast error:', error.message);
      failed += chunk.length;
    }
  }

  return { sent, failed, skipped: false };
}
