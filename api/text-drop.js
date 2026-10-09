import { handleTextDrop } from '../lib/text-drop.mjs';

// Loaded only after application authentication. Provider credentials are
// resolved by the official SDK from Vercel's server environment.
export default {
  fetch(request) {
    return handleTextDrop(request, process.env, () => import('@vercel/blob'));
  }
};
