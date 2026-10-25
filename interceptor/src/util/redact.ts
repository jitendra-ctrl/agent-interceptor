/**
 * Removes secrets from anything Agent Interceptor writes to disk or prints.
 * Applied to reports, run records and logs; fixtures are redacted with the same rules.
 */
const RULES: Array<[RegExp, string]> = [
  // Salesforce access tokens / session IDs: 00D<org>!<token>
  [/00D[A-Za-z0-9]{12,15}![A-Za-z0-9._]+/g, '<redacted-sf-token>'],
  // Bearer tokens in headers or text
  [/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, 'Bearer <redacted>'],
  // OAuth consumer keys (all start with 3MVG)
  [/3MVG[A-Za-z0-9._]{20,}/g, '<redacted-consumer-key>'],
  // JSON fields whose names say they are secret
  [
    /("(?:access_?token|refresh_?token|client_?secret|password|pak|apiKey|api_key|sessionToken)"\s*:\s*")[^"]*(")/gi,
    '$1<redacted>$2',
  ],
];

// Extra rules for screen recordings (INTERCEPTOR_SCREEN_SAFE=1): Salesforce record/org/user IDs
// and usernames/e-mail addresses are masked too. Internal values are unchanged; only output is masked.
const SCREEN_RULES: Array<[RegExp, string]> = [
  [/\b(00D|005|006|001|003|00e|0Ps|01p)[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\b/g, '$1…'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<user>'],
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  if (process.env.INTERCEPTOR_SCREEN_SAFE === '1') {
    for (const [pattern, replacement] of SCREEN_RULES) out = out.replace(pattern, replacement);
  }
  return out;
}

/** Shortens IDs that identify a session but are not useful in a report. */
export function shortId(id: string | undefined | null): string {
  if (!id) return '';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
