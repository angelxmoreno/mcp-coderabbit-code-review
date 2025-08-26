// Simple types for CodeRabbit service
export interface CodeRabbitAnalysis {
    commentId: number;
    aiPrompt: string | null;
    extractedAt: string;
}

export interface PromptExtractionResult {
    found: boolean;
    prompt: string | null;
}
