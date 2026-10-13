'use strict';

const form = document.getElementById('save-form');
const text = document.getElementById('text');
const name = document.getElementById('name');
const submit = document.getElementById('submit');
const status = document.getElementById('status');
const entries = document.getElementById('entries');
const listStatus = document.getElementById('list-status');
const refresh = document.getElementById('refresh');
const more = document.getElementById('more');
const unlockForm = document.getElementById('unlock-form');
const accessCode = document.getElementById('access-code');
const unlockButton = document.getElementById('unlock');
const accessStatus = document.getElementById('access-status');
const appArea = document.getElementById('app');
let cursor = null;
let loading = false;
let pendingUpload = null;

function show(message, kind) { status.textContent = message; status.dataset.kind = kind; }
async function api(action, options = {}, params = {}) {
  const response = await fetch('/api/text-drop?' + new URLSearchParams({action,...params}), {
    cache:'no-store', ...options
  });
  if (!(response.headers.get('content-type') || '').includes('application/json')) {
    throw new Error('The page could not reach file storage. Please try again.');
  }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'The request could not be completed.');
    error.status = response.status; throw error;
  }
  return result;
}
const post = body => ({method:'POST', headers:{'Content-Type':'application/json','X-Text-Drop':'1'}, body:JSON.stringify(body)});
function setUnlocked(value) {
  unlockForm.hidden = value; appArea.hidden = !value;
  if (value) loadTexts(false);
  else { entries.replaceChildren(); cursor = null; more.hidden = true; }
}
function renderEntry(item, first = false) {
  const old = document.getElementById('entry-' + item.id);
  if (old) old.remove();
  const row = document.createElement('article');
  row.className = 'entry'; row.id = 'entry-' + item.id;
  const info = document.createElement('div'); info.className = 'entry-info';
  const title = document.createElement('div'); title.className = 'entry-name'; title.textContent = item.name;
  const meta = document.createElement('div'); meta.className = 'meta';
  const date = new Date(item.createdAt).toLocaleString(undefined, {dateStyle:'medium',timeStyle:'short'});
  meta.textContent = date + ' · ' + (item.bytes / 1024 / 1024).toFixed(2) + ' MiB';
  info.append(title, meta);
  const links = document.createElement('div'); links.className = 'downloads';
  for (const format of ['md','txt']) {
    const link = document.createElement('a'); link.className = 'download';
    link.href = '/api/text-drop?' + new URLSearchParams({action:'download',id:item.id,format});
    link.download = item.name + '.' + format; link.textContent = '↓ .' + format;
    link.setAttribute('aria-label', 'Download ' + item.name + ' as .' + format);
    links.append(link);
  }
  row.append(info, links);
  if (first) entries.prepend(row); else entries.append(row);
}
async function loadTexts(append) {
  if (loading) return;
  loading = true; refresh.disabled = true; more.disabled = true;
  listStatus.textContent = 'Loading saved texts…'; listStatus.dataset.kind = '';
  try {
    const result = await api('list', {}, append && cursor ? {cursor} : {});
    if (appArea.hidden) return;
    if (!append) entries.replaceChildren();
    for (const item of result.items) renderEntry(item);
    cursor = result.cursor; more.hidden = !cursor;
    listStatus.textContent = entries.childElementCount ? '' : cursor ? 'Load more to see earlier texts.' : 'No saved texts yet.';
  } catch (error) {
    listStatus.textContent = 'Could not load saved texts. ' + error.message; listStatus.dataset.kind = 'error';
    if (error.status === 401) { setUnlocked(false); accessStatus.textContent = 'Enter your access code to continue.'; }
  } finally { loading = false; refresh.disabled = false; more.disabled = false; }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;
  const pasted = text.value, label = name.value;
  if (!pasted.trim()) { show('Paste some text before submitting.', 'error'); text.focus(); return; }
  const body = new Blob([pasted], {type:'text/plain'});
  if (body.size > 25 * 1024 * 1024) { show('Text exceeds 25 MiB. Split it into smaller submissions.', 'error'); return; }
  submit.disabled = true; text.readOnly = true; name.readOnly = true;
  document.getElementById('lock').disabled = true;
  submit.textContent = 'Saving…'; show('Saving your text…', 'pending');
  try {
    if (!pendingUpload || pendingUpload.text !== pasted || pendingUpload.name !== label) {
      const prepared = await api('prepare', post({name:label,bytes:body.size}));
      const uploaded = await fetch(prepared.uploadUrl, {
        method:'PUT', headers:{'Content-Type':'text/plain'}, body, credentials:'omit', referrerPolicy:'no-referrer'
      });
      if (!uploaded.ok) throw new Error('The text upload failed. Your text is still in the box.');
      pendingUpload = {id:prepared.id, bytes:body.size, text:pasted, name:label};
    }
    const result = await api('confirm', post({id:pendingUpload.id,bytes:pendingUpload.bytes}));
    pendingUpload = null;
    renderEntry(result.item, true); listStatus.textContent = ''; listStatus.dataset.kind = '';
    show('Saved. Your .md and .txt downloads are available below.', 'success');
  } catch (error) {
    show('Could not confirm the save. ' + error.message + (pendingUpload ? ' Press Submit again to finish this save.' : ' Refresh the saved list before submitting again.'), 'error');
    if (error.status === 401) { setUnlocked(false); accessStatus.textContent = 'Enter your access code to continue. Your draft is still in this browser.'; }
  } finally {
    submit.disabled = false; text.readOnly = false; name.readOnly = false;
    document.getElementById('lock').disabled = false; submit.textContent = 'Submit';
  }
});
refresh.addEventListener('click', () => loadTexts(false));
more.addEventListener('click', () => loadTexts(true));
unlockForm.addEventListener('submit', async event => {
  event.preventDefault(); unlockButton.disabled = true; accessStatus.textContent = 'Opening…';
  try {
    await api('unlock', {method:'POST', headers:{'Content-Type':'text/plain','X-Text-Drop':'1'}, body:accessCode.value.trim()});
    accessCode.value = ''; accessStatus.textContent = ''; setUnlocked(true);
  } catch (error) { accessStatus.textContent = error.message; }
  finally { unlockButton.disabled = false; }
});
document.getElementById('lock').addEventListener('click', async () => {
  try {
    await api('lock', {method:'POST',headers:{'X-Text-Drop':'1'}});
    text.value = ''; name.value = ''; pendingUpload = null; show('',''); setUnlocked(false);
  } catch (error) { show(error.message,'error'); }
});
api('session').then(result => setUnlocked(result.unlocked)).catch(error => {accessStatus.textContent = error.message;});
