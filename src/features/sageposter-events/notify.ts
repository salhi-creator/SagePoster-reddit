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
  createdAt: string | number | undefined,
  details: {
    subreddit?: string | undefined;
    author?: string | undefined;
    postId?: string | undefined;
  }
): Promise<void> {
  const apiBase = (await settings.get<string>('sagePosterApiUrl'))?.trim();
  const authToken = (await settings.get<string>('redditServiceToken'))?.trim();
  if (!apiBase) {
    console.warn('[sageposter] Event skipped: configure the SagePoster API URL.');
    return;
  }
  if (!authToken) {
    console.warn('[sageposter] Event skipped: configure the Reddit service token.');
    return;
  }

  if (!id || !createdAt) {
    console.warn(`[sageposter] ${type} event skipped: missing ID or createdAt.`);
    return;
  }
  if (!details.subreddit || (type === 'comment' && !details.postId)) {
    console.warn(
      `[sageposter] ${type} event skipped: missing subreddit${type === 'comment' ? ' or parent post ID' : ''}.`
    );
    return;
  }

  const redditId = redditFullname(id, type);
  if (redditId.length > 128) {
    console.warn(`[sageposter] ${type} event skipped: Reddit ID exceeds 128 characters.`);
    return;
  }
  if (details.postId && redditFullname(details.postId, 'post').length > 128) {
    console.warn('[sageposter] Comment event skipped: parent post ID exceeds 128 characters.');
    return;
  }
  if (new TextEncoder().encode(JSON.stringify(details)).byteLength > 64 * 1024) {
    console.warn(`[sageposter] ${type} event skipped: details exceed 64 KiB.`);
    return;
  }

  const endpoint = `${apiBase.replace(/\/+$/, '')}/reddit-events`;
  const createdAtDate = typeof createdAt === 'number'
    ? new Date(createdAt >= 1_000_000_000_000 ? createdAt : createdAt * 1000)
    : new Date(createdAt);
  if (Number.isNaN(createdAtDate.getTime())) {
    console.warn(`[sageposter] ${type} event skipped: invalid createdAt.`);
    return;
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      type,
      status: 'pending',
      createdAt: createdAtDate.toISOString(),
      ids: [redditId],
      ...(type === 'comment' && details.postId ? { postId: details.postId } : {}),
      details,
    }),
  });

  if (response.status !== 202) {
    throw new Error(`SagePoster returned HTTP ${response.status} for ${type} event.`);
  }

  const result: unknown = await response.json().catch(() => undefined);
  if (
    !result ||
    typeof result !== 'object' ||
    !('ok' in result) ||
    result.ok !== true ||
    !('streamId' in result) ||
    typeof result.streamId !== 'string' ||
    result.streamId.length === 0
  ) {
    throw new Error(`SagePoster returned an invalid ${type} event acknowledgement.`);
  }
  const streamId = result.streamId;
  console.log(`[sageposter] Accepted ${type} event. Redis streamId:`, streamId);
}

export async function sendPostEventToSagePoster(
  input: OnPostSubmitRequest
): Promise<void> {
  await sendRedditEvent('post', input.post?.id, input.post?.createdAt, {
    subreddit: input.subreddit?.name,
    author: input.author?.name,
  });
}

export async function sendCommentEventToSagePoster(
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
