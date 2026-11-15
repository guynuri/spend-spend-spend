/** Prompts (PLAN §11.3). Payloads come from the pure builders in shared/ai/payloads.ts. */
export const CATEGORIZE_SYSTEM = `You categorize the bank and credit-card transactions of an Israeli household.
Each item's "text" is a merchant description as printed by the bank: often Hebrew, abbreviated, transliterated or cut off
(e.g. "שופרסל דיל", "PAZ YELLOW", "סופר-פארם", "NETFLIX.COM"). Use your knowledge of Israeli chains, brands, utilities,
health funds, government bodies and international online services to work out what the merchant is and sells.
"dir" is "in" (money received) or "out" (money spent); "amount" is rounded to 10.
Reply with JSON only: an array of objects {"i": number, "category": string, "confidence": number between 0 and 1, "reason": string}.
"category" must be exactly one of the provided category names. "reason" is at most 8 words, in the language of the category
names, saying what the merchant is (e.g. "Supermarket chain"). If you do not recognize the merchant or no category clearly fits,
reply "category": "none" with confidence below 0.3. Never guess. No text outside the JSON.`;

export function reviewSystem(language: 'en' | 'he') {
  const lang = language === 'he' ? 'Hebrew (gender-neutral phrasing, plural or infinitive)' : 'English';
  return `You write short, friendly commentary for a household's monthly money review, in ${lang}.
Use only the numbers provided. At most 60 words per field. No advice to buy or sell any financial product, no investment advice.
Reply with JSON only: {"headline": string, "commentary": {"summary": string, "income": string, "spending": string,
"budget": string, "goals": string, "cashflow": string, "wrapup": string}}.`;
}
