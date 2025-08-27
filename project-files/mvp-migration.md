# MVP Migration Plan

## Overview

Migrating from our current CodeRabbit-only implementation to a comprehensive multi-bot code review system based on the MVP demo in `src/mvp/`.

## Migration Goals

1. **Multi-Bot Support**: Extend beyond CodeRabbit to support Korbit and future bots
2. **Rich Comment Parsing**: Extract structured data from bot comments (type, summary, diff, suggested code, etc.)
3. **GraphQL Integration**: Replace REST API with GraphQL for richer metadata
4. **Workflow Engine**: Implement dynamic PR detection and processing
5. **Enhanced Type System**: Adopt rich type hierarchy with proper inheritance

## Current State Analysis

### What We Have
- ✅ Basic CodeRabbit comment detection (`isCodeRabbitComment`)
- ✅ Simple AI prompt extraction (`extractAIPrompt`) 
- ✅ Database integration (`storeCodeRabbitAnalysis`)
- ✅ Error handling with custom errors
- ✅ Comprehensive test coverage
- ✅ GitHub API reply automation

### What We're Missing
- ❌ Multi-bot architecture
- ❌ Rich comment parsing (type, summary, diff, suggested code)
- ❌ GraphQL API usage
- ❌ Automatic PR detection
- ❌ Thread-level metadata (isResolved, isOutdated, isMinimized)
- ❌ Workflow-driven processing

## Migration Plan

### Phase 1: Type System Migration
- [x] Create new rich type interfaces based on MVP
- [x] Update database schema to support multi-bot data
- [x] Migrate existing CodeRabbit types

### Phase 2: Parser Implementation  
- [ ] Implement multi-bot comment parsing system
- [ ] Create structured comment parsers for CodeRabbit and Korbit
- [ ] Add comprehensive comment metadata extraction

### Phase 3: GraphQL Integration
- [ ] Replace REST API calls with GraphQL queries
- [ ] Add thread-level metadata support
- [ ] Implement rich comment fetching

### Phase 4: Workflow Engine
- [ ] Implement automatic repo/branch detection
- [ ] Create dynamic PR finding logic  
- [ ] Build workflow-driven processing system

### Phase 5: Testing & Integration
- [ ] Update all tests for new type system
- [ ] Ensure backward compatibility
- [ ] Validate end-to-end functionality

## Detailed Progress Log

### [IN PROGRESS] Phase 1: Type System Migration

**Completed:**
- ✅ Created `src/types/bots.ts` with enhanced CodeRabbit type system
  - `BaseComment` interface for all comments
  - `CodeRabbitComment` with rich parsing support
  - Type guards (`isCodeRabbitComment`, `isBotComment`)
  - Enhanced analysis interface (`CodeRabbitAnalysis`)
- ✅ Created `src/utils/bot-parser.ts` with comprehensive parsing functions
  - `parseComment()` - detects CodeRabbit comments and parses them
  - `parseCodeRabbitComment()` - extracts type, summary, diff, suggested code, AI prompts, tools
  - `parseComments()` - batch processing
  - `filterActionableComments()` - identifies actionable CodeRabbit comments

**Completed:**
- ✅ Created `src/utils/github-api.ts` with GraphQL-based comment fetching
  - `getPullRequestForBranch()` - finds PR for a branch
  - `getReviewCommentsForPullRequest()` - fetches rich metadata using GraphQL
  - `getCommentsForPR()` - convenience method for direct PR access
  - Extracts thread-level metadata (isResolved, isOutdated, isMinimized)
- ✅ Updated database schema to support CodeRabbit data with extensibility
  - Enhanced `comment` table with CodeRabbit-specific fields (bot_type, comment_type, heading, summary, diff, etc.)
  - Renamed `coderabbit_analysis` to `bot_analysis` for future extensibility
  - Updated all database interfaces and methods
  - Maintained backward compatibility with legacy CodeRabbit methods
- ✅ Architecture refinements based on user feedback
  - Moved utility functions from `services/` to `utils/` (non-class functions)
  - Removed all Korbit-related code (future work, not current release)
  - Focused implementation on CodeRabbit-only for current release
- ✅ Created `src/services/workflow.ts` for automated processing
  - `WorkflowEngine` class with auto-detection capabilities
  - Repository and branch detection using git commands
  - PR finding and comment processing pipeline
  - Configurable workflow with actionable comment filtering

**Issues Found & Resolved:**
- ✅ **RESOLVED**: Consolidated duplicate GitHub API functionality
  - Integrated GraphQL functions from `src/utils/github-api.ts` into `src/services/github.ts`
  - Added `getPullRequestForBranch()`, `getReviewCommentsWithMetadata()`, `getCommentsForPR()` methods
  - Updated `WorkflowEngine` to use `GitHubService` class instead of utility functions
  - Removed duplicate `src/utils/github-api.ts` file
  - Maintained consistent error handling and logging patterns

**Next Steps:**
1. Begin Phase 2: Parser Implementation - integrate new types with existing services
2. Create comprehensive test coverage for new functionality
3. Update existing services to use enhanced database schema

**Status:** ✅ Phase 1 Complete (CodeRabbit-focused) - Ready for Phase 2
**Started:** 2025-08-27
**Phase 1 Completed:** 2025-08-27

---

*This document will be updated throughout the migration process*