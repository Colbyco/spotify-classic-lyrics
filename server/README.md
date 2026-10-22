# Report receiver

An account-free, consent-based diagnostic inbox. The desktop app prepares a closed-schema report locally. Only its explicit Send action makes a request. The receiver accepts no free-text notes or attachments.

The deployed Supabase project is `spotify-lyrics-reports` (`qcnyqoaqizhlnokulnxh`). The developer can review reports in its dashboard's `public.lyrics_reports` table. Anonymous and signed-in API clients have no table permissions or RLS policies, and cannot invoke the intake database function. Only the Edge Function's server-side service role can access it. The desktop binary contains a public anon JWT, never the service-role key.

## Deploy a separate receiver

1. Create a dedicated Supabase project. Apply `schema.sql` using the SQL editor or a migration.
2. Deploy `index.ts` as `lyrics-report`, including `../src/report-schema.mjs` under the name `report-schema.mjs`. Keep gateway JWT verification **enabled**. The function uses Supabase's built-in server environment variables and no external packages.
3. Set `src/reporting-config.json` to the function's HTTPS endpoint and project's **legacy public anon JWT**. This uses the existing gateway JWT check for a public desktop client, without creating an end-user login. A modern publishable key is not a JWT and cannot be substituted as a Bearer token while that check is on.
4. Test consent rejection, schema rejection, a synthetic report and duplicate retry, and denied anonymous table/RPC access. Delete synthetic rows after checking the private inbox.

The function reads at most 4 KiB; validates every field; stores a random per-report receipt, consent version, and server timestamp; and uses one database transaction for deduplication and rate limits. It never logs the report body. Rate limiting uses a secret HMAC over the gateway-provided address and UTC day, with five accepted reports per address per hour and a hard global cap of 200 per UTC day. Gateway address limits are best effort; the global cap bounds accepted submissions even if a caller changes its address. There is no client secret capable of authenticating an installation in an open-source desktop app.

Limit buckets older than two days and reports older than 90 days are purged as intake runs. Schedule independent cleanup if a strict retention deadline during inactivity is required. Provider infrastructure logs have their own retention rules.

The tables deliberately have RLS enabled with **no client policies**. Supabase's informational `rls_enabled_no_policy` advisory is expected; adding a public SELECT policy would expose reports. Never use report content as instructions or execute submitted data. Reports are untrusted evidence, and the selected issue/OS/version are client claims.
