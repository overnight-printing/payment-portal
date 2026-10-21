import { UUID } from './validation.js';

export function paymentPath(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new TypeError('Invalid payment link ID');
  const bytes = id.replaceAll('-', '').match(/../g).map(byte => String.fromCharCode(parseInt(byte, 16))).join('');
  return '/p/' + btoa(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodePaymentCode(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(code)) return null;
  const bytes = atob(code.replaceAll('-', '+').replaceAll('_', '/') + '==');
  const hex = [...bytes].map(byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return paymentPath(id) === '/p/' + code ? id : null;
}
