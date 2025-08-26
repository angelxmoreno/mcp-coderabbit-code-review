// Core database records (exact match to SQL schema)
export interface PrRecord {
    id: number;
    repo: string;
    number: number;
    last_synced: string | null;
}

export interface CommentRecord {
    id: number;
    pr_id: number;
    file: string | null;
    line: number | null;
    author: string | null;
    original_comment: string | null;
    prompt_for_ai_agents: string | null;
    agreement: 'yes' | 'no' | 'partially' | null;
    reply: string | null;
    replied: boolean;
    fix_applied: boolean;
    created_at: string | null;
    reviewed_at: string | null;
    fixed_at: string | null;
}

// Insert types (for creating new records)
export interface PrInsert {
    repo: string;
    number: number;
    last_synced?: string;
}

export interface CommentInsert {
    pr_id: number;
    file?: string | null;
    line?: number | null;
    author?: string | null;
    original_comment?: string | null;
    prompt_for_ai_agents?: string | null;
}

// Update types (for partial updates)
export interface PrUpdate {
    last_synced?: string;
}

export interface CommentUpdate {
    agreement?: 'yes' | 'no' | 'partially' | null;
    reply?: string | null;
    replied?: boolean;
    fix_applied?: boolean;
    reviewed_at?: string | null;
    fixed_at?: string | null;
    // Added these two fields
    original_comment?: string | null;
    prompt_for_ai_agents?: string | null;
}

// Filter types for queries
export interface CommentFilters {
    replied?: boolean;
    fix_applied?: boolean;
    agreement?: 'yes' | 'no' | 'partially';
    author?: string;
}

export interface PrFilters {
    repo?: string;
    status?: 'open' | 'all';
}

// Analytics/reporting types
export interface PrStats {
    total: number;
    replied: number;
    fixed: number;
    pending_ids: string | null; // Comma-separated list of IDs
}

// Helper type for parsing pending IDs
export interface PrStatsProcessed extends Omit<PrStats, 'pending_ids'> {
    pending: number[];
}
