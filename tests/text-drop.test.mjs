import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {handleTextDrop,MAX_BYTES} from '../lib/text-drop.mjs';
import {MemoryBlob} from './memory-blob.mjs';

const origin = 'https://text-drop.test';
const env = {TEXT_DROP_ACCESS_HASH:createHash('sha256').update('preview-code').digest('hex')};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function client(storage) {
  let cookie = '';
  const call = async (action, body, params = {}, additional = {}) => {
    const request = new Request(origin + '/api/text-drop?' + new URLSearchParams({action,...params}), {
      method:body === undefined ? 'GET' : 'POST',
      headers:{cookie, ...(body === undefined ? {} : {'content-type':'application/json','x-text-drop':'1','origin':origin}), ...additional},
      ...(body === undefined ? {} : {body:typeof body === 'string' ? body : JSON.stringify(body)})
    });
    const response = await handleTextDrop(request, env, () => storage);
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  };
  return {call, async unlock() { const response = await call('unlock','preview-code',{}, {'content-type':'text/plain'}); assert.equal(response.status,200); return response; }};
}
async function save(client,storage,text,name = 'Sample') {
  const bytes = new TextEncoder().encode(text);
  const prepared = await client.call('prepare',{bytes:bytes.length,name});
  assert.equal(prepared.status,200);
  const grant = await prepared.json();
  await storage.upload(grant.uploadUrl, bytes);
  return {response:await client.call('confirm',{id:grant.id,bytes:bytes.length}),grant,bytes};
}

test('207,000 words create two private files with exact downloads on another session', async () => {
  const storage = new MemoryBlob(), first = client(storage), second = client(storage);
  await first.unlock();
  const text = ' \t' + 'boz İstanbul naïve 日本語 😀 <script>& *markdown* line\r\n'.repeat(25875) + '\n\t ';
  assert.equal(text.trim().split(/\s+/u).length,207000);
  const saved = await save(first,storage,text,'İstanbul notes');
  assert.equal(saved.response.status,201);
  assert.equal(storage.records.size,2);
  const {item} = await saved.response.json();
  await second.unlock();
  const list = await (await second.call('list')).json();
  assert.deepEqual(list.items,[item]);
  for (const format of ['md','txt']) {
    const response = await second.call('download',undefined,{id:item.id,format});
    assert.equal(response.status,200);
    assert.equal(digest(new Uint8Array(await response.arrayBuffer())),digest(saved.bytes));
    assert.match(response.headers.get('content-disposition'), /^attachment;/);
    assert.ok(response.headers.get('content-disposition').endsWith('.' + format));
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
});
test('uploads above the Function body cap use a constrained direct-storage grant', async () => {
  const storage = new MemoryBlob(), uploader = client(storage);
  await uploader.unlock();
  const text = 'long text '.repeat(600000);
  const saved = await save(uploader,storage,text);
  assert.equal(saved.response.status,201);
  assert.ok(saved.bytes.length > 4.5 * 1024 * 1024);
  const grant = storage.issued[0];
  assert.deepEqual(grant.operations,['put']);
  assert.equal(grant.maximumSizeInBytes,saved.bytes.length);
  assert.deepEqual(grant.allowedContentTypes,['text/plain']);
  assert.ok(grant.pathname.startsWith('text-inject/'));
  await assert.rejects(() => storage.upload(saved.grant.uploadUrl,'overwrite'));
  const download = await uploader.call('download',undefined,{id:saved.grant.id,format:'txt'});
  assert.equal(digest(new Uint8Array(await download.arrayBuffer())),digest(saved.bytes));
});
test('unsigned and forged sessions never reach storage or receive upload grants', async () => {
  let loaded = 0;
  for (const action of ['prepare','confirm','list','download']) {
    const request = new Request(origin + '/api/text-drop?action=' + action, {headers:{cookie:'text_drop_vercel_session=1900000000.' + '0'.repeat(64)}});
    const response = await handleTextDrop(request, env, () => {loaded++; throw new Error('Must not load');});
    assert.equal(response.status,401);
  }
  assert.equal(loaded,0);
  assert.equal((await client(new MemoryBlob()).call('unlock','wrong-code')).status,401);
});
test('access code sets a secure scoped cookie and lock clears it', async () => {
  const visitor = client(new MemoryBlob());
  const opened = await visitor.unlock();
  const cookie = opened.headers.get('set-cookie');
  for (const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/api/text-drop']) assert.ok(cookie.includes(flag));
  assert.equal((await (await visitor.call('session')).json()).unlocked,true);
  assert.ok((await visitor.call('lock','')).headers.get('set-cookie').includes('Max-Age=0'));
  assert.equal((await visitor.call('list')).status,401);
});
test('invalid size, malformed payload and cross-origin writes are rejected', async () => {
  const storage = new MemoryBlob(), visitor = client(storage); await visitor.unlock();
  for (const [body,additional,expected] of [
    [{bytes:0},{},400],[{bytes:MAX_BYTES+1},{},413],[{bytes:'100'},{},400],
    ['{bad',{},400],[{bytes:1,name:'x'.repeat(401)},{},400],
    [{bytes:10},{origin:'https://attacker.test'},403],
    [{bytes:10},{'x-text-drop':''},403],[{bytes:10},{'sec-fetch-site':'cross-site'},403],
    ['a'.repeat(4097),{},413]
  ]) assert.equal((await visitor.call('prepare',body,{},additional)).status,expected);
  assert.equal(storage.issued.length,0);
});
test('same-name submissions remain independent and confirmation is idempotent', async () => {
  const storage = new MemoryBlob(), visitor = client(storage); await visitor.unlock();
  const saves = await Promise.all(['First','Second'].map(text => save(visitor,storage,text,'Same name.txt.txt')));
  assert.ok(saves.every(saved => saved.response.status === 201));
  assert.equal((await saves[0].response.clone().json()).item.name,'Same name.txt');
  assert.notEqual(saves[0].grant.id,saves[1].grant.id);
  const repeated = await visitor.call('confirm',{id:saves[0].grant.id,bytes:saves[0].bytes.length});
  assert.equal(repeated.status,201); assert.equal(storage.records.size,4);
});
test('a failed second-format copy never reports success and can be retried', async () => {
  const storage = new MemoryBlob(), visitor = client(storage); await visitor.unlock();
  storage.copyFailure = true;
  const saved = await save(visitor,storage,'Unchanged text');
  assert.equal(saved.response.status,503);
  assert.ok(!(await saved.response.text()).includes('Simulated'));
  assert.deepEqual((await (await visitor.call('list')).json()).items,[]);
  storage.copyFailure = false;
  assert.equal((await visitor.call('confirm',{id:saved.grant.id,bytes:saved.bytes.length})).status,201);
  assert.equal((await (await visitor.call('list')).json()).items.length,1);
});
test('missing, mismatched and foreign records cannot be confirmed or downloaded', async () => {
  const storage = new MemoryBlob(), visitor = client(storage); await visitor.unlock();
  const prepared = await (await visitor.call('prepare',{bytes:10,name:'Name'})).json();
  assert.equal((await visitor.call('confirm',{id:prepared.id,bytes:10})).status,409);
  await storage.upload(prepared.uploadUrl,'short');
  assert.equal((await visitor.call('confirm',{id:prepared.id,bytes:10})).status,409);
  for (const id of ['../private-journal','https://secret.test/file',prepared.id.replace(/\/.+$/,'/AA')]) {
    assert.equal((await visitor.call('download',undefined,{id,format:'md'})).status,404);
  }
  assert.equal(storage.records.size,1);
});
test('pagination returns each pair once and ignores unfinished uploads', async () => {
  const storage = new MemoryBlob(), visitor = client(storage); await visitor.unlock();
  for (let index=0;index<55;index++) await save(visitor,storage,'Text '+index);
  await (await visitor.call('prepare',{bytes:3})).json();
  let cursor, items=[];
  do {
    const page = await (await visitor.call('list',undefined,cursor ? {cursor} : {})).json();
    items.push(...page.items); cursor=page.cursor;
  } while (cursor);
  assert.equal(items.length,55); assert.equal(new Set(items.map(item=>item.id)).size,55);
});
test('page is standalone, browser script parses and build excludes private/runtime sources', async () => {
  const page = await readFile(new URL('../text-drop.html',import.meta.url),'utf8');
  assert.ok(!page.includes('href="/pages/') && !page.includes('href="/index'));
  assert.ok(!page.includes('<script>') && page.includes('noindex,nofollow'));
  const script = await readFile(new URL('../assets/text-drop.js',import.meta.url),'utf8');
  new vm.Script(script);
  assert.ok(!script.includes('localStorage') && !script.includes('innerHTML'));
  const output = await readdir(new URL('../public/',import.meta.url));
  assert.deepEqual(output.sort(),['assets','index.html','pages','text-drop.html']);
  assert.equal(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),await readFile(new URL('../index.html',import.meta.url),'utf8'));
});
