'use strict';
const $ = id => document.getElementById(id);
let pending = false, report = null;
const command = (name, arg) => window.classicLyrics.command(name, arg);
function render(state) {
  $('message').textContent = state.message;
  $('auto').checked = state.autoRepair;
  $('fix').textContent = state.kind === 'fixed' ? 'Fixed' : state.kind === 'working' ? 'Working…' : 'Fix lyrics layout';
  $('fix').disabled = pending || !['needs-fix', 'error', 'unavailable'].includes(state.kind);
  $('undo').disabled = pending || !state.canUndo;
  $('check').disabled = pending || state.kind === 'working';
  $('auto').disabled = pending || state.kind === 'working';
  $('report').hidden = !state.canReport;
  $('report').disabled = pending || state.kind === 'working';
}
function renderReport(value) {
  report = value;
  $('home').hidden = true; $('report-view').hidden = false;
  $('issue').value = value.report.issue;
  $('findings').replaceChildren(...value.findings.map(finding => { const li = document.createElement('li'); li.textContent = finding.text; return li; }));
  $('report-data').textContent = JSON.stringify(value.report, null, 2);
  $('consent').checked = false;
  $('consent').disabled = value.sent;
  $('issue').disabled = value.sent;
  $('send').textContent = value.sent ? 'Sent' : 'Send report';
  $('send').disabled = true;
  $('report-status').textContent = value.sent ? `Report sent. Reference: ${value.id}` : '';
}
async function act(name, value) {
  if (pending) return;
  pending = true; $('error').hidden = true;
  for (const id of ['fix', 'undo', 'check', 'auto', 'report', 'send', 'save', 'back', 'issue', 'consent']) $(id).disabled = true;
  if (name === 'send-report') $('report-status').textContent = 'Sending…';
  try {
    const result = await command(name, value);
    if (name === 'report' || name === 'report-issue') renderReport(result);
    else if (name === 'send-report') {
      report.sent = result.sent; $('consent').disabled = true; $('issue').disabled = true;
      $('send').textContent = 'Sent'; $('report-status').textContent = `Report sent. Reference: ${result.id}`;
    } else if (name === 'save-report') $('report-status').textContent = result.saved ? 'Report saved on this computer.' : '';
    else if (name === 'report-close') { report = null; $('report-view').hidden = true; $('home').hidden = false; }
    else if (result) render(result);
  } catch (error) {
    if (name === 'report-issue' && report) $('issue').value = report.report.issue;
    $('error').textContent = error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); $('error').hidden = false;
    if (name === 'send-report') $('report-status').textContent = 'Not confirmed. You can retry or save the report.';
  } finally {
    pending = false;
    render(await command('status'));
    $('send').disabled = !report || report.sent || !$('consent').checked;
    $('save').disabled = false; $('back').disabled = false; $('issue').disabled = report?.sent || false;
    $('consent').disabled = report?.sent || false;
  }
}
for (const id of ['fix', 'undo', 'check', 'report']) $(id).addEventListener('click', () => act(id));
$('auto').addEventListener('change', event => act('auto', event.target.checked));
$('back').addEventListener('click', () => act('report-close'));
$('issue').addEventListener('change', event => act('report-issue', { id: report?.id, issue: event.target.value }));
$('consent').addEventListener('change', () => { $('send').disabled = pending || !report || report.sent || !$('consent').checked; });
$('send').addEventListener('click', () => act('send-report', { id: report?.id, consent: $('consent').checked }));
$('save').addEventListener('click', () => act('save-report', { id: report?.id }));
window.classicLyrics.onStatus(render);
command('status').then(render);
