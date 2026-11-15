/**
 * Guard for the honesty rule: the site never presents the rain simulation as
 * a flood forecast or warning.
 *
 * Any message that uses forecast or warning vocabulary is a violation unless
 * it is a reviewed disclaimer: its key is listed in DISCLAIMER_KEYS and the
 * sentence that uses the vocabulary is a negation ("not a forecast").
 */

/** Keys of reviewed disclaimer messages. Add a key only for a sentence that denies the claim. */
export const DISCLAIMER_KEYS: ReadonlySet<string> = new Set<string>([]);

const CLAIM_TERMS: readonly RegExp[] = [
  /\bforecast(s|ed|ing|er|ers)?\b/i,
  /\bpredict(s|ed|ing|ion|ions|ive)?\b/i,
  /\bwarn(s|ed|ing|ings)?\b/i,
  /\balert(s|ed|ing)?\b/i,
  /\bnowcast(s|ing)?\b/i,
  /\bwill flood\b/i,
  /\bflood[- ]risk (map|score|rating|assessment)s?\b/i,
  /\b(is|are) (safe|unsafe) from flood(s|ing)?\b/i,
];

const NEGATION = /\b(not|never|no|cannot|isn't|aren't|doesn't|don't)\b/i;

export interface ClaimViolation {
  readonly key: string;
  readonly sentence: string;
  readonly reason: "not-allowlisted" | "not-negated";
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;:])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function usesClaimTerm(sentence: string): boolean {
  return CLAIM_TERMS.some((term) => term.test(sentence));
}

/** Checks one message. Returns every sentence that reads as a forecast or warning claim. */
export function findClaimViolations(
  key: string,
  message: string,
  disclaimerKeys: ReadonlySet<string> = DISCLAIMER_KEYS,
): ClaimViolation[] {
  const violations: ClaimViolation[] = [];
  for (const sentence of sentences(message)) {
    if (!usesClaimTerm(sentence)) continue;
    if (!disclaimerKeys.has(key)) {
      violations.push({ key, sentence, reason: "not-allowlisted" });
    } else if (!NEGATION.test(sentence)) {
      violations.push({ key, sentence, reason: "not-negated" });
    }
  }
  return violations;
}

export function findAllClaimViolations(
  messages: Iterable<readonly [string, string]>,
  disclaimerKeys: ReadonlySet<string> = DISCLAIMER_KEYS,
): ClaimViolation[] {
  const violations: ClaimViolation[] = [];
  for (const [key, message] of messages) {
    violations.push(...findClaimViolations(key, message, disclaimerKeys));
  }
  return violations;
}
