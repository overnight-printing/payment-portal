import { handleApi } from '../../server/api.js';

export default {
  fetch(request, env, ctx) {
    return handleApi({ request, env, waitUntil: (promise) => ctx.waitUntil(promise) });
  },
};
