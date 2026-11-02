// Parts of the agent screens that are built but switched off, so the calling desk stays small. Flip one to true to
// bring it back; nothing else needs to change.
export const FEATURES = {
  /** The row of six queue cards above the list (the queue picker is a dropdown instead). */
  queueCards: false,
  /** The "Today" start page for agents. Off: agents land straight on their call queue. */
  todayPage: false,
  /** Listings / buyers / last-open / conversion-score tiles and the "why they are in this queue" note on a customer. */
  customerFacts: false,
  /** The "Earlier calls" card under the phone. */
  earlierCalls: false,
  /** The manual "Log this call" form. The call card replaces it; it stays on when the build has no phone line. */
  manualLog: false,
  /** Team performance, Geography and Allocation in the admin menu. The Overview page replaces them. */
  adminExtras: false,
} as const;
