'use strict';
const crypto = require('node:crypto');
const config = require('./reporting-config.json');

// The reviewed snapshot is kept in the main process. The renderer cannot supply
// an endpoint or replace the report at send time. Nothing is queued on disk.
class Reports {
  constructor(send = fetch) { this.send = send; this.current = null; this.sending = false; }
  async prepare(report) {
    if (this.sending) throw new Error('Wait for the current report to finish.');
    const { validateReport, analyze } = await import('./report-schema.mjs');
    if (this.sending) throw new Error('Wait for the current report to finish.');
    validateReport(report);
    this.current = { id: crypto.randomUUID(), report: structuredClone(report), sent: false, created: Date.now() };
    return this.view(analyze);
  }
  view(analyze) { return { id: this.current.id, report: structuredClone(this.current.report), findings: analyze(this.current.report), sent: this.current.sent }; }
  async update(id, issue) {
    const { ISSUES, analyze } = await import('./report-schema.mjs');
    if (!this.current || id !== this.current.id || !ISSUES.includes(issue) || this.sending || this.current.sent) throw new Error('Run the checks again.');
    this.current.report.issue = issue;
    return this.view(analyze);
  }
  async submit({ id, consent } = {}) {
    if (consent !== true) throw new Error('Please review the report and give permission before sending.');
    if (!this.current || id !== this.current.id || Date.now() - this.current.created > 15 * 60 * 1000) throw new Error('Run the checks again before sending.');
    if (this.sending) throw new Error('A report is already being sent.');
    if (this.current.sent) return { sent: true, id: this.current.id };
    const reviewed = this.current;
    this.sending = true;
    try {
      const { validateReport } = await import('./report-schema.mjs');
      validateReport(reviewed.report);
      const response = await this.send(config.endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json', apikey: config.anonKey, authorization: `Bearer ${config.anonKey}` },
        body: JSON.stringify({ id: reviewed.id, consent: true, report: reviewed.report }),
        signal: AbortSignal.timeout(15000), redirect: 'error', credentials: 'omit'
      });
      if (!response.ok) throw new Error(response.status === 429 ? 'Too many reports have been sent. Please try again later.' : 'The report could not be sent. You can save it or try again.');
      const receipt = await response.json();
      if (receipt.id !== reviewed.id || receipt.accepted !== true) throw new Error('The report was not confirmed. Please try again.');
      reviewed.sent = true;
      return { sent: true, id: receipt.id };
    } catch (error) {
      if (/^Too many|^The report/.test(error.message)) throw error;
      throw new Error('The report could not be sent. Check your connection, save it, or try again.');
    } finally { this.sending = false; }
  }
}
module.exports = { Reports };
