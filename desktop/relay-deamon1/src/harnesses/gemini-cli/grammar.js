/**
 * Gemini CLI approval-prompt grammar (ILLUSTRATIVE).
 *
 * PTY-proxy gating is only as good as these patterns, and they MUST be derived
 * empirically against the installed Gemini CLI version — its real prompt wording
 * may differ from the examples below. Pin this grammar to a CLI version; a
 * cosmetic prompt change can shift the match.
 *
 * detect(buffer) returns null, or:
 *   { matched: true, summary, command?, answers: { approve, deny } }
 * `answers` are the literal keystrokes written back into the PTY.
 */
const PATTERNS = [
  // e.g. "Allow execution of 'rm -rf build'? [y/N]"
  { re: /Allow execution of [`'"]?(.+?)[`'"]?\?\s*\[y\/N\]/i, key: { approve: 'y\r', deny: 'n\r' } },
  // e.g. "Apply this change to src/index.js? (y/n)"
  { re: /Apply this change to (.+?)\?\s*\(y\/n\)/i,           key: { approve: 'y\r', deny: 'n\r' } },
  // e.g. "Do you want to proceed? [Y/n]"  (menu-style: Enter = yes)
  { re: /Do you want to proceed\?\s*\[Y\/n\]/i,              key: { approve: '\r', deny: 'n\r' } },
]

export const grammar = {
  detect(buffer) {
    for (const { re, key } of PATTERNS) {
      const m = buffer.match(re)
      if (m) {
        return {
          matched: true,
          summary: (m[1] || 'pending action').trim().slice(0, 120),
          command: (m[1] || '').trim() || null,
          answers: key,
        }
      }
    }
    return null
  },
}
