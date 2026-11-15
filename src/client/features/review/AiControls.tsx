export interface AiReview {
  headline: string;
  commentary: Record<string, string>;
  model?: string;
}
/** AI commentary controls — implemented in M9. */
export function AiReviewControls(_p: { month: string; status: 'draft' | 'completed'; ai: AiReview | null }) {
  return null;
}
