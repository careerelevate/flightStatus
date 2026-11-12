# Flight Status

The GitHub Pages site includes sample flights and a flight-number lookup powered by Aviationstack. A Cloudflare Worker proxies the lookup so the Aviationstack key is not exposed in browser code.

## Enable live flight lookup

1. Create an Aviationstack account and copy its API key. The free plan has a limited monthly request allowance and is for non-commercial use; check the current [Aviationstack pricing](https://aviationstack.com/pricing).
2. Install Node.js, sign in to a Cloudflare account with Wrangler, and deploy the Worker from this repository:

   ```powershell
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put AVIATIONSTACK_API_KEY
   ```

   Enter the Aviationstack key at the Wrangler prompt. Do not put the key in this repository or share it in chat.
3. Copy the Worker URL printed by Wrangler. Set `window.FLIGHT_STATUS_API_URL` in `api-config.js` to the Worker URL, such as `https://flightstatus-api.your-account.workers.dev`.
4. Commit and push the `api-config.js` change. GitHub Pages will redeploy with live lookup enabled.

The Worker accepts flight-number lookups, restricts browser access to the site, and briefly caches successful results to help conserve the free API request allowance.

## Test

Run the Worker tests with Node.js:

```powershell
node --test worker.test.mjs
```
