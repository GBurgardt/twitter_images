#!/usr/bin/env python3
import os
import sys
import json

try:
    import praw
except ImportError:
    sys.stderr.write("Missing dependency: praw. Install with `pip install praw`.\n")
    sys.exit(1)


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: fetch_reddit.py <url>\n")
        sys.exit(1)

    url = sys.argv[1]
    client_id = os.environ.get("REDDIT_CLIENT_ID")
    client_secret = os.environ.get("REDDIT_CLIENT_SECRET")
    user_agent = os.environ.get("REDDIT_USER_AGENT", "twx-reddit/0.1")
    comment_sort = os.environ.get("REDDIT_COMMENT_SORT", "confidence")
    comment_limit_env = os.environ.get("REDDIT_COMMENT_LIMIT")
    comment_limit = None
    if comment_limit_env:
        try:
            comment_limit = int(comment_limit_env)
        except ValueError:
            pass

    if not client_id or not client_secret:
        sys.stderr.write("Missing REDDIT_CLIENT_ID or REDDIT_CLIENT_SECRET environment variables.\n")
        sys.exit(1)

    reddit = praw.Reddit(
        client_id=client_id,
        client_secret=client_secret,
        user_agent=user_agent,
        check_for_async=False,
    )

    submission = reddit.submission(url=url)
    submission.comment_sort = comment_sort

    submission_title = submission.title or ""
    submission_selftext = submission.selftext or ""
    comments = []
    submission.comments.replace_more(limit=None)

    for comment in submission.comments.list():
        if getattr(comment, "body", None):
            comments.append(render_comment(comment))
            if comment_limit and len(comments) >= comment_limit:
                break

    payload = {
        "title": submission_title,
        "selftext": submission_selftext,
        "comments": comments,
        "permalink": submission.permalink,
        "score": submission.score,
        "subreddit": str(submission.subreddit),
        "author": str(submission.author) if submission.author else None,
        "comment_count": submission.num_comments,
    }

    print(json.dumps(payload))


def render_comment(comment):
    author = f"u/{comment.author}" if comment.author else "[deleted]"
    score = getattr(comment, "score", None)
    header_parts = [author]
    if score is not None:
        header_parts.append(f"(score: {score})")

    indent = "  " * getattr(comment, "depth", 0)
    header = " ".join(header_parts)
    body = getattr(comment, "body", "")
    return f"{indent}{header}\n{indent}{body}"


if __name__ == "__main__":
    main()
