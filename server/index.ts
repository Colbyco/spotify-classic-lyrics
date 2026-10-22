import { validateReport } from './report-schema.mjs';

const response = (status: number, body: object) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});
async function boundedJson(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('body');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4096) { await reader.cancel(); throw new Error('body'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return response(405, { error: 'method_not_allowed' });
  // The gateway verifies this legacy public-client JWT. It grants no access to
  // the private tables. No service key is distributed with the desktop app.
  if (!req.headers.get('content-type')?.startsWith('application/json')) return response(415, { error: 'json_required' });
  let input;
  try {
    input = await boundedJson(req);
    if (Object.keys(input).length !== 3 || input.consent !== true || typeof input.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.id)) throw new Error('report');
    validateReport(input.report);
  } catch { return response(400, { error: 'invalid_report' }); }
  try {
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const address = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const hash = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(new Date().toISOString().slice(0, 10) + ':' + address));
    const clientHash = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
    const saved = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/accept_lyrics_report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: secret, Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ p_id: input.id, p_report: input.report, p_client_hash: clientHash }),
      signal: AbortSignal.timeout(8000), redirect: 'error'
    });
    if (!saved.ok) return response(503, { error: 'temporarily_unavailable' });
    const result = await saved.json();
    if (result === 'rate_limited') return response(429, { error: 'rate_limited' });
    if (result !== input.id) return response(503, { error: 'temporarily_unavailable' });
    return response(200, { accepted: true, id: input.id });
  } catch { return response(503, { error: 'temporarily_unavailable' }); }
});
