// Which language a customer is called in, and which one an agent is "primary" for.
// Plain data and functions only: the server imports this too.
//
// Rule from the team meeting: Tamil Nadu and Puducherry → Tamil, Kerala → Malayalam, Andhra Pradesh and Telangana →
// Telugu, Karnataka → Kannada, every other state → Hindi. "Others" is for a customer who speaks something none of
// those cover; an agent or admin sets it by hand. English is a language an agent may speak as a second one, never a
// language a customer is called in.
import type { AgentAccount, Language } from '../data/types.ts';

/** Languages a customer can be called in. */
export const CUSTOMER_LANGUAGES: Language[] = ['Tamil', 'Malayalam', 'Telugu', 'Kannada', 'Hindi', 'Others'];

/** Every language an agent can be set up for, in the order the pickers show them. */
export const AGENT_LANGUAGES: Language[] = [...CUSTOMER_LANGUAGES, 'English'];

const STATE_LANGUAGE: Record<string, Language> = {
  'Tamil Nadu': 'Tamil',
  Puducherry: 'Tamil',
  Kerala: 'Malayalam',
  'Andhra Pradesh': 'Telugu',
  Telangana: 'Telugu',
  Karnataka: 'Kannada',
};

/** The language customers in a state are called in. */
export const languageForState = (state: string | null | undefined): Language => (state && STATE_LANGUAGE[state]) || 'Hindi';

/** What the product (or a spreadsheet, or an old record) calls a language → the language we call in. Null = not one we offer. */
const BY_NAME: Record<string, Language> = {
  ta: 'Tamil', tamil: 'Tamil',
  ml: 'Malayalam', malayalam: 'Malayalam',
  te: 'Telugu', telugu: 'Telugu',
  kn: 'Kannada', kannada: 'Kannada',
  hi: 'Hindi', hindi: 'Hindi',
  bn: 'Hindi', bengali: 'Hindi', // Bengali customers are looked after by the Hindi agents
  others: 'Others', other: 'Others',
};

export function customerLanguageFrom(raw: string | null | undefined): Language | null {
  return (raw && BY_NAME[raw.trim().toLowerCase()]) || null;
}

/** An agent's primary language: the one they are asked for first. Never English; falls back to the first they speak. */
export function primaryLanguageOf(agent: Pick<AgentAccount, 'languages' | 'primaryLanguage'>): Language | null {
  if (agent.primaryLanguage && agent.primaryLanguage !== 'English' && agent.languages.includes(agent.primaryLanguage)) return agent.primaryLanguage;
  return agent.languages.find((l) => l !== 'English') ?? null;
}
