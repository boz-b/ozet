// A local test double only. Production imports the official Vercel Blob SDK.
import {randomUUID} from 'node:crypto';
import {BlobNotFoundError} from '@vercel/blob';

export class MemoryBlob {
  BlobNotFoundError = BlobNotFoundError;
  records = new Map();
  grants = new Map();
  issued = [];
  copyFailure = false;
  constructor(origin = 'https://storage.test') { this.origin = origin; }
  async issueSignedToken(options) { this.issued.push(options); return {options}; }
  async presignUrl(token, options) {
    const key = randomUUID(); this.grants.set(key, {...token.options,...options});
    return {presignedUrl:this.origin + '/_test-upload/' + key};
  }
  async upload(url, body, contentType = 'text/plain') {
    const grant = this.grants.get(new URL(url).pathname.split('/').pop());
    if (!grant || grant.validUntil <= Date.now()) throw new Error('Invalid grant');
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    if (bytes.length > grant.maximumSizeInBytes || !grant.allowedContentTypes.includes(contentType) || this.records.has(grant.pathname)) throw new Error('Upload constraint rejected');
    this.records.set(grant.pathname, {bytes, contentType, uploadedAt:new Date()});
    return {pathname:grant.pathname};
  }
  async head(pathname) {
    const record = this.records.get(pathname);
    if (!record) throw new BlobNotFoundError();
    return {pathname, size:record.bytes.length, contentType:record.contentType, uploadedAt:record.uploadedAt};
  }
  async copy(source, destination, options) {
    if (this.copyFailure) throw new Error('Simulated private provider failure');
    if (options.access !== 'private' || !this.records.has(source) || this.records.has(destination)) throw new Error('Invalid copy');
    const original = this.records.get(source);
    this.records.set(destination, {...original, bytes:original.bytes.slice()});
    return this.head(destination);
  }
  async list({prefix,limit,cursor}) {
    const names = [...this.records.keys()].filter(name => name.startsWith(prefix)).sort();
    const start = cursor ? names.findIndex(name => name > cursor) : 0;
    const selected = start < 0 ? [] : names.slice(start,start + limit);
    const hasMore = start >= 0 && start + limit < names.length;
    return {blobs:await Promise.all(selected.map(pathname => this.head(pathname))), hasMore, cursor:hasMore ? selected.at(-1) : undefined};
  }
  async get(pathname, options) {
    if (options.access !== 'private') throw new Error('Public read attempted');
    const record = this.records.get(pathname);
    if (!record) return null;
    return {statusCode:200, stream:new ReadableStream({start(controller) {controller.enqueue(record.bytes); controller.close();}}), blob:await this.head(pathname)};
  }
}
