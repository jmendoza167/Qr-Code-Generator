/**
 * Plain-text rendering of an inspection report. The caller supplies the
 * escape function (the CLI passes its printable()), so this module stays
 * free of Node and the decoded content is never printed raw by accident.
 */
const TYPE_LABELS = {
  url: 'URL',
  wifi: 'Wi-Fi network',
  vcard: 'contact card (vCard)',
  email: 'email (mailto:)',
  phone: 'phone number (tel:)',
  sms: 'text message (sms:)',
  geo: 'location (geo:)',
  text: 'plain text',
  scheme: 'other scheme',
};

/**
 * @param {import('./inspect.js').InspectionReport} report
 * @param {{ escape?: (text: string) => string }} [options]
 * @returns {string}
 */
export function formatReport(report, { escape = (text) => text } = {}) {
  const lines = [];
  lines.push(`Verdict: ${report.verdict === 'none' ? 'no findings' : report.verdict.toUpperCase()}`);
  lines.push(`Type: ${TYPE_LABELS[report.type] ?? report.type}`);

  const { meta } = report;
  if (meta && Number.isInteger(meta.version)) {
    const parts = [`version ${meta.version}`];
    if (meta.ecc) parts.push(`level ${meta.ecc}`);
    if (Number.isInteger(meta.mask)) parts.push(`mask ${meta.mask}`);
    if (Number.isInteger(meta.errorsCorrected)) parts.push(`${meta.errorsCorrected} codeword${meta.errorsCorrected === 1 ? '' : 's'} corrected`);
    if (meta.inverted) parts.push('inverted colours');
    lines.push(`Symbol: ${parts.join(', ')}`);
  }

  if (report.findings.length > 0) {
    lines.push('');
    lines.push('Findings:');
    for (const f of report.findings) {
      lines.push(`  [${f.severity.toUpperCase()}] ${escape(f.title)}: ${escape(f.detail)}${f.where && f.where !== 'payload' ? ` (in ${escape(f.where)})` : ''}`);
    }
  }

  lines.push('');
  lines.push('Content (escaped):');
  lines.push(escape(report.text));
  lines.push('');
  lines.push(report.disclaimer);
  return `${lines.join('\n')}\n`;
}
