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
- [x] Integrate new parsing system with existing CodeRabbitService
- [x] Update services to use enhanced database schema
- [x] Add comprehensive test coverage for parsing functionality

### Phase 3: GraphQL Integration
- [x] Replace REST API calls with GraphQL queries
- [x] Add thread-level metadata support
- [x] Implement rich comment fetching

### Phase 4: Workflow Engine
- [x] Implement automatic repo/branch detection
- [x] Create dynamic PR finding logic  
- [x] Build workflow-driven processing system

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

**Phase 2 Completed:**
- ✅ **Enhanced CodeRabbitService Integration**
  - Added `parseCodeRabbitComments()` method using new type system
  - Added `analyzeEnhancedComment()` method with rich metadata extraction
  - Integrated with new database schema using `storeBotAnalysis()`
  - Maintained backward compatibility with existing methods

- ✅ **Comprehensive Test Coverage**
  - Created `tests/unit/utils/bot-parser.test.ts` with 15 test cases
  - Tests cover comment parsing, type extraction, AI prompt detection
  - Tests validation of suggested code, tools extraction, internal IDs
  - Tests for complex CodeRabbit comments with all metadata fields
  - All 80 tests passing across the entire test suite

**Next Steps:**
1. Begin Phase 5: End-to-end Integration Testing
2. Document new API usage patterns
3. Performance optimization and monitoring

**Status:** ✅ Phases 1-4 Complete (CodeRabbit-focused) - Ready for Phase 5
**Started:** 2025-08-27
**Phase 1-4 Completed:** 2025-08-27

---

*This document will be updated throughout the migration process*