/**
 * Where the deployed sync server lives.
 *
 * The web client never needs this — it is served by the same Worker and uses
 * its own origin. It exists for the desktop app, which has to be told where to
 * sign in and would otherwise make the user type a URL from memory.
 */
export const DEFAULT_SYNC_SERVER = 'https://better.a-benmasseoud23353.workers.dev'
