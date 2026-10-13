import { UUID, validEmail } from '../shared/validation.js';

export const deliveryStates = { sent: 'accepted', delivered: 'delivered', delivery_delayed: 'delayed', bounced: 'bounced', failed: 'failed', complained: 'complained', suppressed: 'suppressed' };

export function emailEvent(payload) {
  const status = deliveryStates[payload?.type?.replace(/^email\./, '')];
  if (!status) return null;
  const data = payload.data;
  if (!UUID.test(data?.email_id || '') || typeof payload.created_at !== 'string' || !Number.isFinite(Date.parse(payload.created_at)) || Date.parse(payload.created_at) > Date.now() + 300000 ||
    !Array.isArray(data.to) || !data.to.length || data.to.length > 2 || !data.to.every(validEmail)) throw new Error('invalid_webhook');
  const tags = data.tags;
  const tagged = tags?.portal_app === 'payment_portal';
  if (tagged && (!UUID.test(tags.portal_request || '') || !UUID.test(tags.portal_link || '') || !['payment_link', 'customer_receipt', 'staff_receipt'].includes(tags.portal_kind))) throw new Error('invalid_webhook');
  return { provider_id: data.email_id, request_id: tagged ? tags.portal_request : null, link_id: tagged ? tags.portal_link : null, kind: tagged ? tags.portal_kind : null, recipients: data.to, status, occurred_at: payload.created_at };
}

export async function verifyWebhook(request, rawBody, secret, now = Date.now()) {
  const id = request.headers.get('svix-id') || '';
  const timestamp = request.headers.get('svix-timestamp') || '';
  const signatures = request.headers.get('svix-signature') || '';
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(id) || !/^\d{1,12}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || signatures.length > 1000) throw new Error('invalid_webhook');
  try {
    if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) throw new Error();
    const bytes = Uint8Array.from(atob(secret.slice(6)), (char) => char.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const content = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`);
    for (const signature of signatures.split(' ')) {
      if (!/^v1,[A-Za-z0-9+/]+={0,2}$/.test(signature)) continue;
      let signed;
      try { signed = Uint8Array.from(atob(signature.slice(3)), (char) => char.charCodeAt(0)); } catch { continue; }
      if (await crypto.subtle.verify('HMAC', key, signed, content)) {
        const payload = JSON.parse(rawBody);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
        return { event_id: id, event: emailEvent(payload) };
      }
    }
  } catch { throw new Error('invalid_webhook'); }
  throw new Error('invalid_webhook');
}
