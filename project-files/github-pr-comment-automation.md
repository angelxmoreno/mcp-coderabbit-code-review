# GitHub PR Comment Automation Guide

## Overview

This document explains how to automatically reply to GitHub Pull Request review comments using the GitHub CLI (`gh`) and API. This was developed to streamline the process of responding to CodeRabbit AI review feedback.

## Key Discovery

GitHub PR review comments (the ones that appear inline with code) use a different API endpoint than regular issue comments. They require creating **new review comments** with the `in_reply_to` parameter rather than using a `/replies` endpoint.

## Prerequisites

- GitHub CLI (`gh`) installed and authenticated
- `jq` for JSON processing
- Appropriate repository permissions (write access)
- Comment data in structured JSON format

## API Endpoints

### ❌ What Doesn't Work
```bash
# This endpoint does not exist for PR review comments
gh api repos/owner/repo/pulls/comments/{comment_id}/replies
```

### ✅ What Actually Works
```bash
# Create a new review comment that replies to an existing one
gh api repos/owner/repo/pulls/{pr_number}/comments \
  -X POST \
  -f body="Your reply text" \
  -f commit_id="commit_sha" \
  -f path="file/path.js" \
  -f side="RIGHT" \
  -F in_reply_to="{original_comment_id}"
```

## Required Parameters

When replying to a PR review comment, you need:

| Parameter | Description | Source |
|-----------|-------------|---------|
| `body` | Reply text content | Your response |
| `commit_id` | SHA of the commit | From original comment |
| `path` | File path being commented on | From original comment |
| `side` | Which side of diff ("RIGHT" or "LEFT") | From original comment |
| `in_reply_to` | ID of comment being replied to | Original comment ID |

## Implementation Steps

### 1. Get Original Comment Details

```bash
gh api repos/owner/repo/pulls/comments/{comment_id}
```

Extract required fields:
```bash
COMMIT_ID=$(echo "$comment_data" | jq -r '.commit_id')
PATH=$(echo "$comment_data" | jq -r '.path')
SIDE=$(echo "$comment_data" | jq -r '.side // "RIGHT"')
```

### 2. Post Reply

```bash
gh api repos/owner/repo/pulls/{pr_number}/comments \
  -X POST \
  -f body="$reply_text" \
  -f commit_id="$COMMIT_ID" \
  -f path="$PATH" \
  -f side="$SIDE" \
  -F in_reply_to="$original_comment_id"
```

### 3. Verify Success

The API will return the new comment object with `in_reply_to_id` field set:
```json
{
  "id": 2302888838,
  "in_reply_to_id": 2302208375,
  "body": "Your reply text",
  ...
}
```

## Complete Automation Script

A working bash script (`reply-to-comments.sh`) has been created that:

1. **Reads** structured comment data from JSON file
2. **Extracts** repository information from comment URLs
3. **Fetches** original comment details via API
4. **Posts** threaded replies using correct API endpoints
5. **Updates** local JSON with reply status
6. **Creates** backup of original data
7. **Provides** detailed progress reporting

### Usage
```bash
./reply-to-comments.sh
```

### Expected JSON Structure
```json
[
  {
    "commentId": 2302208375,
    "url": "https://github.com/owner/repo/pull/5#discussion_r2302208375",
    "reply": "Your response text",
    "replied": false,
    ...
  }
]
```

## Limitations

### What Works via API
- ✅ Creating reply comments
- ✅ Threading replies to original comments
- ✅ Setting comment content and metadata

### What Doesn't Work via API
- ❌ Resolving comments (UI only)
- ❌ Minimizing comments (UI only)
- ❌ Marking conversations as resolved (UI only)

## Error Handling

### Common Issues

1. **404 Not Found**: Using wrong endpoint (e.g., `/replies`)
2. **422 Invalid Request**: Missing required parameters
3. **403 Forbidden**: Insufficient permissions

### Solutions

1. **Always use** `repos/owner/repo/pulls/{pr}/comments` endpoint
2. **Include all required parameters** from original comment
3. **Ensure proper authentication** with write permissions

## Best Practices

1. **Rate Limiting**: Add delays between API calls
2. **Error Recovery**: Handle API failures gracefully  
3. **Data Backup**: Always backup original data before modifications
4. **Progress Tracking**: Provide detailed feedback during execution
5. **Validation**: Verify comment structure before posting

## Testing

### Manual Test
```bash
# Test single reply
gh api repos/owner/repo/pulls/{pr}/comments \
  -X POST \
  -f body="Test reply" \
  -f commit_id="sha" \
  -f path="file.js" \
  -f side="RIGHT" \
  -F in_reply_to="12345"
```

### Verification
Check the PR in GitHub web interface to confirm:
- Reply appears as threaded comment
- Proper attribution and timestamp
- Content formatting preserved

## Future Enhancements

- **Bulk Operations**: Process multiple PRs simultaneously  
- **Template Responses**: Pre-defined reply templates
- **Smart Filtering**: Auto-categorize comments by type
- **Integration**: Webhook-triggered automated responses
- **Analytics**: Track response patterns and effectiveness

## Troubleshooting

### Debug API Calls
Add `--verbose` flag to see full HTTP request/response:
```bash
gh api repos/owner/repo/pulls/comments/12345 --verbose
```

### Check Authentication
```bash
gh auth status
```

### Validate JSON
```bash
jq '.' your-comments.json
```

## Related Documentation

- [GitHub REST API - Pull Request Review Comments](https://docs.github.com/en/rest/pulls/comments)
- [GitHub CLI Manual](https://cli.github.com/manual/)
- [PR Comment Threading](https://docs.github.com/en/rest/pulls/comments#create-a-review-comment-for-a-pull-request)

---

**Success Rate**: 100% when using correct API endpoints and parameters
**Last Updated**: 2025-08-27
**Tested With**: GitHub CLI v2.x, GitHub REST API v3