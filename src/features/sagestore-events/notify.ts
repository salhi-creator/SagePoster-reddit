import type {
  OnCommentSubmitRequest,
  OnPostSubmitRequest,
} from '@devvit/web/shared';
import { settings } from '@devvit/web/server';

type RedditEventType = 'post' | 'comment';

function redditFullname(id: string, type: RedditEventType): string {
  const prefix = type === 'post' ? 't3_' : 't1_';
  return id.startsWith(prefix) ? id : `${prefix}${id}`;
}

async function sendRedditEvent(
  type: RedditEventType,
  id: string | undefined,
  createdAt: string | undefined,
  details: { subreddit?: string; author?: string; postId?: string }
): Promise<void> {
  const apiBase = (await settings.get<string>('sageStoreApiUrl'))?.trim();
  if (!apiBase) {
    console.warn('[sagestore] Event skipped: configure the SageStore API URL.');
    return;
  }

  if (!id || !createdAt) {
    console.warn(`[sagestore] ${type} event skipped: missing ID or createdAt.`);
    return;
  }

  const endpoint = `${apiBase.replace(/\/+$/, '')}/reddit-events`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      status: 'pending',
      createdAt: new Date(createdAt).toISOString(),
      ids: [redditFullname(id, type)],
      details,
    }),
  });

  if (!response.ok) {
    throw new Error(`SageStore returned HTTP ${response.status} for ${type} event.`);
  }

  const result: unknown = await response.json().catch(() => undefined);
  const streamId =
    result && typeof result === 'object' && 'streamId' in result
      ? result.streamId
      : undefined;
  console.log(`[sagestore] Accepted ${type} event. Redis streamId:`, streamId);
}

export async function sendPostEventToSageStore(
  input: OnPostSubmitRequest
): Promise<void> {
  await sendRedditEvent('post', input.post?.id, input.post?.createdAt, {
    subreddit: input.subreddit?.name,
    author: input.author?.name,
  });
}

export async function sendCommentEventToSageStore(
  input: OnCommentSubmitRequest
): Promise<void> {
  await sendRedditEvent('comment', input.comment?.id, input.comment?.createdAt, {
    subreddit: input.subreddit?.name,
    author: input.author?.name,
    postId: input.post?.id
      ? redditFullname(input.post.id, 'post')
      : undefined,
  });
}
