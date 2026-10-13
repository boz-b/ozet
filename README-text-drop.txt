Text Drop for the existing ozet Vercel project

Page: /text-drop.html. Existing research pages and navigation are unchanged.
Open the same page on either computer and enter the same reusable access code.
Paste into the textbox and press Submit, then download .md or .txt below.
The page supports UTF-8 submissions up to 25 MiB. Browser textarea values are
saved without trimming, Markdown conversion, or extra wrappers.

Storage and authentication

Use a PRIVATE Vercel Blob store connected to the existing ozet project.
Pasted texts are never committed to this public GitHub repository. Text Drop
stores the actual .txt and .md files under text-inject/ in the private store.
An authenticated, narrowly scoped, short-lived PUT grant uploads the original
directly from the browser. The server verifies its size, creates the Markdown
copy within private storage, and confirms that both files exist before showing
success. Both formats preserve the same bytes.

All listing, upload authorization, confirmation, and download routes require
the access-code session. The code is not embedded in the page or source. Set
TEXT_DROP_ACCESS_HASH to its SHA-256 hex digest in Vercel's server environment.
Never put the plaintext code or Blob credentials in Git or browser JavaScript.
Vercel resolves the Blob credentials through the official SDK (OIDC/store ID
when available, or the project's BLOB_READ_WRITE_TOKEN fallback).

The session expires after eight hours and uses an HttpOnly, SameSite cookie
with Secure on HTTPS. Lock clears the session and the browser's current draft.
Anyone with the reusable access code can view this same inbox.

Deployment

Install the locked dependencies with pnpm install --frozen-lockfile. The
official @vercel/blob SDK is pinned at 2.8.1. The page uses native fetch.
Create/connect a private Blob store in ozet's Storage settings, configure the
access-code hash, and enable the production environment. A shared production
store in Preview would give preview deployments access to the same text; use
a separate store if preview isolation is needed.

vercel.json builds only index.html, pages/, assets/, and text-drop.html into
public/. Vercel separately builds api/text-drop.js. Local secrets, private
context, downloaded text, and the earlier unpublished Sites draft are excluded.
Do not publish the earlier Sites draft: the selected destination is Vercel.

Verification

Run npm run build, then npm test. The tests use a memory Blob test double,
not the live provider. They cover exact 207,000-word downloads in two sessions,
uploads larger than the Function body limit, constrained upload grants,
authentication, failed-copy retry, unique names, pagination, and private output
exclusions. scripts/preview-text-drop.mjs is an optional local preview using
synthetic text only; its test-only code is preview-code. It never calls Vercel.

Before sharing the live URL, verify a synthetic 207,000-word submission on the
actual private store, independently unlock a second session, compare both
downloads to the original textarea bytes, and verify anonymous requests fail.
