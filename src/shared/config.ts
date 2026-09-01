/**
 * Where the deployed sync server lives.
 *
 * The web client never needs this — it is served by the same Worker and uses
 * its own origin. It exists for the desktop app, which has to be told where to
 * sign in and would otherwise make the user type a URL from memory.
 */
export const DEFAULT_SYNC_SERVER = 'https://better.a-benmasseoud23353.workers.dev'

/**
 * Where the Windows installer comes from.
 *
 * A path, not a host: the Worker serves it, streaming from R2 because a 109 MB
 * installer is far larger than a Worker asset may be. Until that bucket exists
 * the same route redirects to the releases page, so the button is never dead.
 */
export const DOWNLOAD_URL = '/download'
