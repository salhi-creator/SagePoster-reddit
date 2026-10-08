import { Hono } from 'hono';
import { reddit } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';

// These routes are mounted at /external in src/index.ts and are called by
// SagePoster using a Devvit managed token (Authorization: Bearer devvit_at_...).
export const api = new Hono();

type CreatePostRequest = {
  subreddit: string;
  title: string;
  body?: string;
};

type CreateCommentRequest = {
  postId: string;
  body: string;
};

type DeletePostRequest = {
  postId: string;
};

const MAX_PAGE_SIZE = 30;

function parsePageSize(rawValue: string | undefined): number {
  const parsed = Number.parseInt(rawValue ?? '25', 10);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(parsed, 1), MAX_PAGE_SIZE);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asT3(id: string): T3 {
  return (id.startsWith('t3_') ? id : `t3_${id}`) as T3;
}

api.get('/posts', async (c) => {
  const subreddit = c.req.query('subreddit');
  if (!isNonEmptyString(subreddit)) {
    return c.json({ error: 'subreddit query parameter is required.' }, 400);
  }

  const limit = parsePageSize(c.req.query('limit'));
  const sort = c.req.query('sort') ?? 'new';
  if (sort !== 'new' && sort !== 'hot') {
    return c.json({ error: 'sort must be either "new" or "hot".' }, 400);
  }

  try {
    const listing = sort === 'hot'
      ? reddit.getHotPosts({
          subredditName: subreddit.trim().replace(/^r\//i, ''),
          limit,
          pageSize: limit,
        })
      : reddit.getNewPosts({
          subredditName: subreddit.trim().replace(/^r\//i, ''),
          limit,
          pageSize: limit,
        });
    const posts = await listing.all();

    return c.json({
      ok: true,
      subreddit: subreddit.trim().replace(/^r\//i, ''),
      sort,
      posts: posts.map((post) => ({
        id: post.id,
        title: post.title,
        body: post.body ?? null,
        url: post.url,
        permalink: post.permalink,
        author: post.authorName,
        subreddit: post.subredditName,
        createdAt: post.createdAt.toISOString(),
        score: post.score,
        commentCount: post.numberOfComments,
        removed: post.removed,
      })),
    });
  } catch (error) {
    console.error('[external-api] Failed to fetch subreddit posts', error);
    return c.json({ error: 'Reddit could not fetch subreddit posts.' }, 502);
  }
});

api.get('/comments', async (c) => {
  const postId = c.req.query('postId');
  if (!isNonEmptyString(postId)) {
    return c.json({ error: 'postId query parameter is required.' }, 400);
  }
  const limit = parsePageSize(c.req.query('limit'));

  try {
    const comments = await reddit
      .getComments({ postId: asT3(postId), limit, pageSize: limit })
      .all();

    return c.json({
      ok: true,
      postId: asT3(postId),
      comments: comments.map((comment) => ({
        id: comment.id,
        postId: comment.postId,
        parentId: comment.parentId,
        body: comment.body,
        author: comment.authorName,
        createdAt: comment.createdAt.toISOString(),
        score: comment.score,
        permalink: comment.permalink,
        removed: comment.removed,
      })),
    });
  } catch (error) {
    console.error('[external-api] Failed to fetch post comments', error);
    return c.json({ error: 'Reddit could not fetch comments for the post.' }, 502);
  }
});

api.post('/posts', async (c) => {
  let input: CreatePostRequest;
  try {
    input = await c.req.json<CreatePostRequest>();
  } catch {
    return c.json({ error: 'Request body must be valid JSON.' }, 400);
  }

  if (!isNonEmptyString(input.subreddit) || !isNonEmptyString(input.title)) {
    return c.json({ error: 'subreddit and title are required.' }, 400);
  }
  if (input.body !== undefined && typeof input.body !== 'string') {
    return c.json({ error: 'body must be a string when provided.' }, 400);
  }

  try {
    const post = await reddit.submitPost({
      subredditName: input.subreddit.trim().replace(/^r\//i, ''),
      title: input.title.trim(),
      text: input.body ?? '',
      runAs: 'APP',
    });

    return c.json({ ok: true, postId: post.id, url: post.url }, 201);
  } catch (error) {
    console.error('[external-api] Failed to submit post', error);
    return c.json({ error: 'Reddit could not create the post.' }, 502);
  }
});

api.post('/posts/delete', async (c) => {
  let input: DeletePostRequest;
  try {
    input = await c.req.json<DeletePostRequest>();
  } catch {
    return c.json({ error: 'Request body must be valid JSON.' }, 400);
  }

  if (!isNonEmptyString(input.postId)) {
    return c.json({ error: 'postId is required.' }, 400);
  }

  try {
    const post = await reddit.getPostById(asT3(input.postId.trim()));
    await post.delete();
    return c.json({ ok: true, postId: input.postId.trim() });
  } catch (error) {
    console.error('[external-api] Failed to delete post', error);
    return c.json({ error: 'Reddit could not delete the post.' }, 502);
  }
});

api.post('/comments', async (c) => {
  let input: CreateCommentRequest;
  try {
    input = await c.req.json<CreateCommentRequest>();
  } catch {
    return c.json({ error: 'Request body must be valid JSON.' }, 400);
  }

  if (!isNonEmptyString(input.postId) || !isNonEmptyString(input.body)) {
    return c.json({ error: 'postId and body are required.' }, 400);
  }

  try {
    const comment = await reddit.submitComment({
      id: asT3(input.postId.trim()),
      text: input.body,
      runAs: 'APP',
    });

    return c.json({ ok: true, commentId: comment.id, url: comment.url }, 201);
  } catch (error) {
    console.error('[external-api] Failed to submit comment', error);
    return c.json({ error: 'Reddit could not create the comment.' }, 502);
  }
});
