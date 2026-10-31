import { notesCall } from './notes';

/** Sends one piece of feedback. Failing (no server, offline) never gets in the agent's way: the verdict is still kept on the call. */
export async function sendFeedback(body: object): Promise<boolean> {
  try {
    await notesCall('POST', '/api/feedback', body);
    return true;
  } catch {
    return false;
  }
}
