import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const MAX_BYTES = 25 * 1024 * 1024;
const PREFIX = 'text-inject/';
const SESSION_SECONDS = 8 * 60 * 60;
const ID_PATTERN = /^(\d{13})-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/([A-Za-z0-9_-]{1,534})$/;
const headers = { 'cache-control':'no-store', 'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer' };

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers:{...headers, 'content-type':'application/json; charset=utf-8'}
});

function secret(env) {
  if (!/^[a-f0-9]{64}$/.test(env.TEXT_DROP_ACCESS_HASH || '')) {
    throw new RequestError(503, 'Text Drop access has not been configured yet.');
  }
  return env.TEXT_DROP_ACCESS_HASH;
}
const signature = (value, hash) => createHmac('sha256', hash).update(value).digest('hex');
function unlocked(request, hash) {
  const cookie = (request.headers.get('cookie') || '').match(/(?:^|;\s*)text_drop_vercel_session=(\d{10})\.([a-f0-9]{64})(?:;|$)/);
  if (!cookie) return false;
  const now = Math.floor(Date.now() / 1000), expires = Number(cookie[1]);
  if (expires <= now || expires > now + SESSION_SECONDS + 10) return false;
  return timingSafeEqual(Buffer.from(cookie[2], 'hex'), Buffer.from(signature(cookie[1], hash), 'hex'));
}
function cookie(value, url, clear = false) {
  return 'text_drop_vercel_session=' + value + '; Path=/api/text-drop; HttpOnly; SameSite=Strict' +
    (url.protocol === 'https:' ? '; Secure' : '') + (clear ? '; Max-Age=0' : '');
}
function verifyWrite(request, url) {
  const origin = request.headers.get('origin'), fetchSite = request.headers.get('sec-fetch-site');
  if ((origin && origin !== url.origin) || request.headers.get('x-text-drop') !== '1' ||
      (fetchSite && !['same-origin','none'].includes(fetchSite))) {
    throw new RequestError(403, 'Submit text from the Text Drop page.');
  }
}
async function readSmallBody(request, limit = 4096) {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new RequestError(413, 'Request is too large.');
  const parts = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); throw new RequestError(413, 'Request is too large.'); }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  try { return new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(Buffer.concat(parts)); }
  catch { throw new RequestError(400, 'The request could not be read.'); }
}
async function readJSON(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new RequestError(415, 'Send a JSON request.');
  const body = await readSmallBody(request);
  try {
    const result = JSON.parse(body);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new RequestError(400, 'The request could not be read.'); }
}
function byteCount(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new RequestError(400, 'Paste some text before submitting.');
  if (bytes > MAX_BYTES) throw new RequestError(413, 'Text exceeds the 25 MiB limit.');
  return bytes;
}
function cleanName(value, createdAt) {
  if (value !== undefined && (typeof value !== 'string' || value.length > 400)) throw new RequestError(400, 'The name is too long.');
  const name = Array.from((value || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').trim().replace(/\.(md|txt)$/i, '')).slice(0,100).join('');
  return name && name !== '.' && name !== '..' ? name : 'text-' + createdAt.replace(/[:.]/g, '-');
}
function identify(id) {
  const match = typeof id === 'string' && id.match(ID_PATTERN);
  if (!match) throw new RequestError(404, 'Text not found.');
  const bytes = Buffer.from(match[2], 'base64url');
  let name;
  try { name = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
  catch { throw new RequestError(404, 'Text not found.'); }
  if (bytes.toString('base64url') !== match[2] || Array.from(name).length > 100 ||
      !name || name.trim() !== name || ['.','..'].includes(name) ||
      /[\\/:*?"<>|\u0000-\u001f\u007f]/u.test(name)) throw new RequestError(404, 'Text not found.');
  const created = 9999999999999 - Number(match[1]);
  if (created < 0 || created > Date.now() + 60000) throw new RequestError(404, 'Text not found.');
  return {id, name, createdAt:new Date(created).toISOString()};
}
function item(blob) {
  return {...identify(blob.pathname.slice(PREFIX.length, -3)), bytes:blob.size};
}
function filename(name, format) {
  return encodeURIComponent(name + '.' + format).replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
}
async function metadata(storage, pathname) {
  try { return await storage.head(pathname); }
  catch (error) {
    if (storage.BlobNotFoundError && error instanceof storage.BlobNotFoundError) return null;
    throw error;
  }
}

export async function handleTextDrop(request, env, loadStorage) {
  const url = new URL(request.url), action = url.searchParams.get('action');
  try {
    const hash = secret(env);
    if (action === 'session' && request.method === 'GET') return json({unlocked:unlocked(request, hash)});
    if (action === 'unlock' && request.method === 'POST') {
      verifyWrite(request, url);
      const code = await readSmallBody(request, 512);
      const actual = createHash('sha256').update(code).digest();
      if (!timingSafeEqual(actual, Buffer.from(hash, 'hex'))) throw new RequestError(401, 'The access code is incorrect.');
      const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
      const response = json({unlocked:true});
      response.headers.set('set-cookie', cookie(expires + '.' + signature(expires, hash), url));
      return response;
    }
    if (action === 'lock' && request.method === 'POST') {
      verifyWrite(request, url);
      const response = json({unlocked:false});
      response.headers.set('set-cookie', cookie('', url, true));
      return response;
    }
    if (!unlocked(request, hash)) throw new RequestError(401, 'Enter your Text Drop access code.');
    if (request.method === 'POST') verifyWrite(request, url);
    const storage = await loadStorage();
    if (action === 'prepare' && request.method === 'POST') {
      const body = await readJSON(request), bytes = byteCount(body.bytes);
      const createdAt = new Date().toISOString(), name = cleanName(body.name, createdAt);
      const id = String(9999999999999 - Date.now()).padStart(13,'0') + '-' + randomUUID() + '/' + Buffer.from(name).toString('base64url');
      const pathname = PREFIX + id + '.txt', validUntil = Date.now() + 15 * 60 * 1000;
      // This grant can create just one named object, within the declared byte
      // limit. It grants no read, list, delete, or overwrite access.
      const token = await storage.issueSignedToken({pathname, operations:['put'], validUntil,
        allowedContentTypes:['text/plain'], maximumSizeInBytes:bytes});
      const {presignedUrl} = await storage.presignUrl(token, {operation:'put', access:'private', pathname, validUntil,
        allowedContentTypes:['text/plain'], maximumSizeInBytes:bytes, addRandomSuffix:false, allowOverwrite:false});
      return json({id, uploadUrl:presignedUrl});
    }
    if (action === 'confirm' && request.method === 'POST') {
      const body = await readJSON(request), bytes = byteCount(body.bytes);
      identify(body.id);
      const textPath = PREFIX + body.id + '.txt', markdownPath = PREFIX + body.id + '.md';
      const original = await metadata(storage, textPath);
      if (!original) throw new RequestError(409, 'The upload has not been saved. Submit again.');
      if (original.size !== bytes || !original.contentType?.startsWith('text/plain')) throw new RequestError(409, 'The upload could not be verified.');
      let markdown = await metadata(storage, markdownPath);
      if (!markdown) {
        try {
          // Private provider-side copy preserves every byte and creates the
          // second format without sending the long text through a Function.
          await storage.copy(textPath, markdownPath, {access:'private', addRandomSuffix:false, allowOverwrite:false});
        } catch (error) {
          // Two tabs may confirm the same upload. Accept only a verified,
          // already-created pair, never a provider error by itself.
          if (!(await metadata(storage, markdownPath))) throw error;
        }
        markdown = await metadata(storage, markdownPath);
      }
      if (!markdown || markdown.size !== bytes) throw new RequestError(503, 'Both downloads could not be confirmed yet. Try confirming again.');
      return json({item:item(markdown)}, 201);
    }
    if (action === 'list' && request.method === 'GET') {
      const cursor = url.searchParams.get('cursor');
      if (cursor && cursor.length > 2048) throw new RequestError(400, 'Invalid page cursor.');
      const result = await storage.list({prefix:PREFIX, limit:100, ...(cursor ? {cursor} : {})});
      const items = [];
      for (const blob of result.blobs) {
        // Markdown objects are created only after the original upload was
        // verified, so half-finished uploads never appear as saved pairs.
        if (blob.pathname.startsWith(PREFIX) && blob.pathname.endsWith('.md')) {
          try { items.push(item(blob)); } catch (error) { if (!(error instanceof RequestError)) throw error; }
        }
      }
      items.sort((a,b) => a.id.localeCompare(b.id));
      return json({items, cursor:result.hasMore ? result.cursor : null});
    }
    if (action === 'download' && request.method === 'GET') {
      const id = url.searchParams.get('id'), format = url.searchParams.get('format');
      const record = identify(id);
      if (!['md','txt'].includes(format)) throw new RequestError(404, 'Text not found.');
      const result = await storage.get(PREFIX + id + '.' + format, {access:'private', useCache:false});
      if (result?.statusCode !== 200 || !result.stream) throw new RequestError(404, 'Text not found.');
      // Stream large downloads without buffering a Function response.
      // The body is never rendered as HTML or parsed as Markdown.
      return new Response(result.stream, {headers:{...headers,
        'content-type':format === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8',
        'content-disposition':'attachment; filename="text-drop.' + format + '"; filename*=UTF-8\'\'' + filename(record.name, format)
      }});
    }
    throw new RequestError(404, 'Page or method not found.');
  } catch (error) {
    if (error instanceof RequestError) return json({error:error.message}, error.status);
    return json({error:'File storage could not complete the request. Please try again.'}, 503);
  }
}
