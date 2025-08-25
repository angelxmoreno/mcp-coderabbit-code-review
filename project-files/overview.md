# CodeRabbit + GitHub MCP Server

## Project Overview

An MCP (Model Context Protocol) server that automates the code review workflow between CodeRabbit AI and GitHub, eliminating manual copy-paste operations and enabling AI agents to handle PR comment triage and responses automatically.

## Problem Statement

Current manual workflow is inefficient:
1. CodeRabbit AI posts review comments with "Prompt for AI Agents" metadata
2. Developer copies each prompt to Claude/AI agent
3. AI agent analyzes and provides agreement (yes/no/partial)
4. Developer manually copies AI response back to GitHub
5. If agreed, developer applies suggested fixes
6. Process repeats for all comments

## Solution Architecture

### Core Components

**MCP Server (Bun + TypeScript)**
- HTTP server exposing domain-specific tools to AI agents
- SQLite database for persistent state management
- Docker containerization for cross-platform distribution

**State Management**
- Local SQLite database (`.coderabbit-mcp/state.db`)
- Tracks comment lifecycle from creation to resolution
- Enables resumable workflows and concurrent processing

**AI Agent Integration**
- Works with Claude Code subagents
- Natural language commands trigger automated workflows
- Manual triggering via terminal sessions

## Database Schema

```sql
CREATE TABLE pr (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  last_synced TEXT
);

CREATE TABLE comment (
  id INTEGER PRIMARY KEY,
  pr_id INTEGER NOT NULL REFERENCES pr(id),
  file TEXT,
  line INTEGER,
  author TEXT,
  original_comment TEXT,
  prompt_for_ai_agents TEXT,
  agreement TEXT CHECK(agreement IN ('yes','no','partially')),
  reply TEXT,
  replied BOOLEAN,
  fix_applied BOOLEAN,
  created_at TEXT,
  reviewed_at TEXT,
  fixed_at TEXT
);
```

## MCP Server Endpoints

### Workflow Management
- **`syncPrComments`**
    - Input: `{ prNumber: number }`
    - Action: Fetch latest review comments from GitHub API, filter for CodeRabbit metadata, insert/update SQLite state
    - Output: `{ synced: number, new: number, updated: number }`

- **`reviewComments`**
    - Input: `{ prNumber: number, filters?: { replied?: boolean, fixApplied?: boolean } }`
    - Action: Query unresolved comments from SQLite with optional filtering
    - Output: `{ comments: Array<{ id, file, line, originalComment, promptForAiAgents }> }`

- **`getReviewReport`**
    - Input: `{ prNumber: number }`
    - Action: Generate summary statistics from SQLite state
    - Output: `{ total: number, replied: number, fixed: number, pending: Array<commentId> }`

### Comment Management
- **`replyToComment`**
    - Input: `{ commentId: number, message: string }`
    - Action: Post reply via GitHub API, update SQLite `replied=true`, timestamp
    - Output: `{ success: boolean, replyId?: number }`

- **`markCommentAsResolved`**
    - Input: `{ commentId: number }`
    - Action: Mark review thread resolved via GitHub GraphQL API, update SQLite state
    - Output: `{ success: boolean }`

- **`applyFix`**
    - Input: `{ commentId: number, patch: string, commitMessage?: string }`
    - Action: Apply git patch, commit changes, push to PR branch, update SQLite `fixApplied=true`
    - Output: `{ success: boolean, commitHash?: string }`

### Analysis Support
- **`updateCommentAnalysis`**
    - Input: `{ commentId: number, agreement: "yes"|"no"|"partially", reasoning?: string }`
    - Action: Update SQLite with AI agent analysis results
    - Output: `{ success: boolean }`

- **`listPrs`**
    - Input: `{ repo?: string, status?: "open"|"all" }`
    - Action: List tracked PRs from SQLite with sync timestamps
    - Output: `{ prs: Array<{ prNumber, repo, lastSynced, commentCount }> }`

## Automated Workflow

```
User: "review pr comments"
├── MCP: syncPrComments(42)
├── MCP: reviewComments(42) → returns unresolved items
├── AI Agent: analyzes each comment using CodeRabbit prompts
├── MCP: replyToComment(id, response) for each
└── MCP: applyFix(id, patch) where agreement = yes/partial
```

## Distribution Strategy

**Docker MCP Catalog Integration**
- Published through Docker's official MCP Catalog system
- One-click installation via Docker Desktop's MCP Toolkit
- Automatic container lifecycle management (no manual docker pull/run)
- Cross-platform compatibility with built-in secret management

**Developer Setup**
```json
{
  "servers": {
    "coderabbit": {
      "type": "docker",
      "image": "yourusername/mcp-coderabbit-github:latest",
      "ports": {"3000": "3000"},
      "environment": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

**Installation Flow**
1. Browse Docker MCP Catalog in Docker Desktop
2. Click "Connect" on CodeRabbit + GitHub MCP server
3. Configuration automatically added to Claude/Cursor/etc.
4. Container auto-pulled and started with proper isolation

## Technical Decisions

### CodeRabbit Integration
- **Scope**: Exclusively supports CodeRabbit AI review format
- **Validation**: Uses Zod schema validation for "Prompt for AI Agents" metadata
- **Graceful degradation**: Warns and skips comments missing required metadata rather than failing

### Database Implementation
- **Technology**: Bun's native SQLite implementation (`bun:sqlite`)
- **Performance**: Built-in optimizations, prepared statements, type safety
- **Concurrency**: WAL mode enabled for concurrent reads during writes
- **Location**: `.coderabbit-mcp/state.db` in project root (gitignored)

### Error Handling Strategy
- **GitHub API**: Exponential backoff with 3 retry attempts
- **Rate Limiting**: Respect GitHub headers, queue requests, meaningful error responses
- **Authentication**: Validate PAT format on startup, require minimum scopes (`repo`, `read:packages`)
- **Circuit Breaker**: Fail fast when GitHub consistently unavailable, fallback to SQLite-only operations

### API Response Standardization
All MCP endpoints return a consistent response format:
```typescript
{
  success: boolean,
  data?: any,        // Present on successful operations
  error?: string,    // Present on failures
  metadata?: object  // Optional additional context
}
```

### Environment Configuration
Variables are provided via MCP client configuration rather than server-side .env files:
```json
{
  "servers": {
    "coderabbit": {
      "type": "docker",
      "image": "yourusername/mcp-coderabbit-github:latest", 
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

### Database Migration Strategy
- **Versioning**: Uses SQLite's `PRAGMA user_version` for schema version tracking
- **Migration**: Simple schema comparison on startup, migrate if version < current
- **Approach**: Declarative schema definition with automatic table/column detection

### Logging Strategy
- **Library**: Pino with pino-pretty for structured logging and human-readable output
- **Output**: All logs to stderr (stdout interferes with MCP protocol)
- **Levels**: Standard pino levels (trace, debug, info, warn, error, fatal)
- **Access**: Logs captured automatically by MCP clients (Claude Desktop, etc.)
- **Configuration**: JSON structured logs in production, pretty-printed in development

### Startup Sequence
1. Load environment variables from MCP client configuration
2. Initialize SQLite database with WAL mode enabled
3. Check schema version and run migrations if needed
4. Validate GitHub token format and basic connectivity
5. Start HTTP server and register MCP endpoints
6. Begin accepting MCP protocol requests

## Future Considerations

**Scalability Concerns**
- SQLite file growth over time without cleanup strategy
- GitHub API rate limiting for high-volume repositories
- Memory usage with large PR comment datasets

**Reliability Issues**
- Error handling for failed AI responses
- Network timeouts during GitHub API calls
- State corruption recovery mechanisms

**Security Considerations**
- GitHub token management in containerized environment
- MCP server authentication/authorization
- Audit logging for automated actions

## Success Metrics

- Time reduction from manual copy-paste workflow
- Accuracy of AI agent comment analysis
- Developer adoption rate and feedback
- Reduced context switching during code reviews