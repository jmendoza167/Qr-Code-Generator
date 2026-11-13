/**
 * Checks that apply to any payload: characters that are invisible or that
 * change how the text is displayed or interpreted.
 */

/** Bidirectional embeddings, overrides and isolates (U+202A..202E, U+2066..2069). */
const BIDI_RE = /[‪-‮⁦-⁩]/g;
/** C0 and C1 control characters except tab, line feed and carriage return. */
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/**
 * @param {string} text
 * @returns {Array<{id: string, severity: string, title: string, detail: string, where: string}>}
 */
export function inspectText(text) {
  const findings = [];
  const bidi = text.match(BIDI_RE);
  if (bidi) {
    findings.push({
      id: 'text-bidi',
      severity: 'high',
      title: 'Bidirectional override characters',
      detail: `${bidi.length} invisible character${bidi.length === 1 ? '' : 's'} that can display the text reversed, so what you read is not what gets opened.`,
      where: 'payload',
    });
  }
  const control = text.match(CONTROL_RE);
  if (control) {
    findings.push({
      id: 'text-control',
      severity: 'medium',
      title: 'Control characters in the content',
      detail: `${control.length} control character${control.length === 1 ? '' : 's'} (such as ESC) that a terminal or app may interpret instead of display.`,
      where: 'payload',
    });
  }
  return findings;
}
