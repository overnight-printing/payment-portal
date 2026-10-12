export async function apiRequest(path, { timeout = 15000, signal, ...options } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(path, { credentials: 'same-origin', ...options, signal: controller.signal });
        let data = null;
        try { data = await response.json(); } catch { /* Unexpected response bodies stay out of user-facing messages. */ }
        return { response, data };
      })(),
      new Promise((_, reject) => { timer = window.setTimeout(() => { controller.abort(); reject(new DOMException('Request timed out', 'TimeoutError')); }, timeout); }),
    ]);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function postJson(body) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export async function withDeadline(promise, milliseconds = 20000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error('operation_timeout')), milliseconds); })]); }
  finally { window.clearTimeout(timer); }
}
