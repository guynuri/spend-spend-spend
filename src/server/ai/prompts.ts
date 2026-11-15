/** Prompts (PLAN §11.3). Payloads come from the pure builders in shared/ai/payloads.ts. */
export const CATEGORIZE_SYSTEM = `You categorize household bank transactions. Reply with JSON only: an array of objects
{"i": number, "category": string, "confidence": number between 0 and 1}. "category" must be exactly one of the provided
category names, or "none" if unsure. Do not add explanations.`;

export function reviewSystem(language: 'en' | 'he') {
  const lang = language === 'he' ? 'Hebrew (gender-neutral phrasing, plural or infinitive)' : 'English';
  return `You write short, friendly commentary for a household's monthly money review, in ${lang}.
Use only the numbers provided. At most 60 words per field. No advice to buy or sell any financial product, no investment advice.
Reply with JSON only: {"headline": string, "commentary": {"summary": string, "income": string, "spending": string,
"budget": string, "goals": string, "cashflow": string, "wrapup": string}}.`;
}
