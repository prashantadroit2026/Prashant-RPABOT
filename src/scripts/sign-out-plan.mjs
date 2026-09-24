/**
 * Sign-out / pre-sign-in sequencing shared by the auth client.
 *
 * In the live preview the app runs inside an iframe with PARTITIONED cookies,
 * so a popup sign-in cannot read the session cookie — it captures a bearer
 * token instead. Clearing a prior session ("switching providers") is therefore
 * local-only and must be bounded so a request that never settles cannot hang
 * the popup flow. When deployed the server owns the session (HttpOnly cookie),
 * so sign-out must go through the server and wait for confirmation.
 */

/**
 * End any prior session BEFORE a new popup sign-in so switching providers
 * actually switches identity. Resolves quickly in the live preview.
 * @param {object} opts
 * @param {boolean} [opts.livePreview]
 * @param {boolean} [opts.hasBearer]
 * @param {() => (void | Promise<unknown>)} [opts.requestSignOut]
 * @param {() => void} [opts.clearToken]
 */
export async function runPreSignInSignOut({ livePreview, hasBearer, requestSignOut, clearToken } = {}) {
  if (livePreview) {
    clearToken?.();
    return;
  }
  if (hasBearer) clearToken?.();
  if (typeof requestSignOut === "function") {
    try {
      await requestSignOut();
    } catch {
      // A failed server sign-out must not block opening a new sign-in.
    }
  }
}

/**
 * Sign out of this app, server-side when deployed, local-only in the preview.
 * Rejects when deployed if the server never confirms, so the UI can offer a
 * retry; in the live preview the local clear is sufficient and always resolves.
 * @param {object} opts
 * @param {boolean} [opts.livePreview]
 * @param {boolean} [opts.hasBearer]
 * @param {() => (void | Promise<unknown>)} [opts.requestSignOut]
 * @param {() => void} [opts.clearToken]
 * @param {() => void} [opts.redirect]
 */
export async function runSignOut({ livePreview, hasBearer, requestSignOut, clearToken, redirect } = {}) {
  if (livePreview) {
    clearToken?.();
    redirect?.();
    return;
  }
  await requestSignOut?.();
  if (hasBearer) clearToken?.();
  redirect?.();
}