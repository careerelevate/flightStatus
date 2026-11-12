# Flight Status

The GitHub Pages site provides flight-number lookups through a Cloudflare Worker. Successful results are stored in Cloudflare Workers KV for five minutes, so repeat lookups use saved data before contacting a provider. Aviationstack is the primary provider; AirLabs is used as a backup when Aviationstack reports that its request limit has been reached. Provider keys stay in Cloudflare Worker secrets and are not exposed in browser code.

## Enable live flight lookup

1. Create free accounts with [Aviationstack](https://aviationstack.com/signup/free/monthly/) and [AirLabs](https://airlabs.co/signup), then copy each API key. Free-plan limits and terms can change; check the providers' current account details and [Aviationstack pricing](https://aviationstack.com/pricing).
2. Install Node.js, sign in to Cloudflare with Wrangler, and deploy the Worker from this repository:

   ```powershell
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put AVIATIONSTACK_API_KEY
   npx wrangler secret put AIRLABS_API_KEY
   ```

   Enter each key only at its Wrangler prompt. Do not put keys in this repository or share them in chat. If the Worker is already deployed, adding the AirLabs key is enough to enable the backup:

   ```powershell
   npx wrangler secret put AIRLABS_API_KEY
   ```
3. Copy the Worker URL printed by Wrangler. Set `window.FLIGHT_STATUS_API_URL` in `api-config.js` to that URL, such as `https://flightstatus-api.your-account.workers.dev`.
4. Commit and push the `api-config.js` change. GitHub Pages will redeploy with live lookup enabled.

The Worker accepts flight-number lookups and restricts browser access to the site. It checks KV before either provider and stores successful responses for five minutes. Use the flight path's **Refresh position** button to request a fresh provider result immediately; each tap uses provider API allowance. Workers KV is available on Cloudflare's Free plan; its current limits are listed in the [KV pricing documentation](https://developers.cloudflare.com/kv/platform/pricing/). AirLabs results label times as UTC or airport-local, depending on the fields provided.

## Flight path display

The page colors the route green when no delay is reported, yellow for 1–30 minutes, red for 31–120 minutes, and purple for more than 120 minutes. Cancellations are marked with a red `CANCELLED` label and symbol. The small aircraft marker stays at the origin before departure, follows calculated progress based on live latitude/longitude when the user taps **Refresh position**, moves to the destination after landing, and is replaced by a cancellation symbol when the flight is cancelled. The page does not refresh aircraft data in the background. A side panel shows the time remaining to the estimated arrival (or scheduled arrival adjusted by a reported delay), the arrival time, and the reported delay in minutes. For airborne flights, the Worker calculates approximate great-circle route progress from the aircraft's latitude/longitude and both airports' coordinates; altitude is shown separately. Airport coordinates are looked up through AirLabs when the flight provider does not include them and are cached in KV for 30 days. Set `AIRLABS_API_KEY` to enable that lookup. If the aircraft position or airport coordinates are missing, the page says that progress is unavailable instead of guessing.

## Test

Run the Worker tests with Node.js:

```powershell
node --test worker.test.mjs
```
