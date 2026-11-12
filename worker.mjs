const allowedOrigins = new Set([
  "https://careerelevate.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

const statusLabels = {
  active: { label: "In flight", className: "in-flight" },
  cancelled: { label: "Cancelled", className: "cancelled" },
  diverted: { label: "Diverted", className: "diverted" },
  incident: { label: "Incident", className: "incident" },
  landed: { label: "Landed", className: "landed" },
  scheduled: { label: "Scheduled", className: "scheduled" },
};

function corsHeaders(origin) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });

  if (allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}

function jsonResponse(body, status, origin, maxAge = 0) {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", maxAge ? `public, max-age=${maxAge}` : "no-store");

  return new Response(JSON.stringify(body), { status, headers });
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapAirport(airport) {
  return {
    airport: text(airport?.airport),
    iata: text(airport?.iata),
    terminal: text(airport?.terminal),
    gate: text(airport?.gate),
    scheduled: text(airport?.scheduled),
    timezone: text(airport?.timezone),
    timezoneLabel: text(airport?.timezoneLabel),
  };
}

function mapFlight(record, requestedFlight) {
  const rawStatus = text(record.flight_status)?.toLowerCase() || "unknown";
  const status = statusLabels[rawStatus] || { label: "Status unavailable", className: "unknown" };

  return {
    flightDate: text(record.flight_date),
    flightNumber: text(record.flight?.iata) || requestedFlight,
    airline: text(record.airline?.name),
    status: status.label,
    statusClass: status.className,
    departure: mapAirport(record.departure),
    arrival: mapAirport(record.arrival),
  };
}

function normalizeFlightIata(value) {
  return text(value)?.toUpperCase().replace(/[\s-]/g, "") || null;
}

function aviationstackLimitReached(response, payload) {
  const error = payload?.error;
  const code = text(error?.code)?.toLowerCase();
  const message = text(error?.message) || text(error) || "";

  return response.status === 429
    || code === "usage_limit_reached"
    || code === "rate_limit_exceeded"
    || /(?:usage|monthly|request|rate)\s+(?:limit|quota)|(?:limit|quota)\s+(?:reached|exceeded)/i.test(message);
}

function firstText(...values) {
  return values.map(text).find(Boolean) || null;
}

function formatAirlabsTime(value) {
  const time = text(value);
  if (!time) return null;

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(time)) {
    return `${time.replace(" ", "T")}:00Z`;
  }

  return time;
}

function mapAirlabsFlight(record, requestedFlight) {
  const rawStatus = text(record.status)?.toLowerCase() || "unknown";
  const normalizedStatus = rawStatus === "en-route"
    ? "active"
    : rawStatus === "on-ground"
      ? "landed"
      : rawStatus;
  const status = statusLabels[normalizedStatus] || { label: "Status unavailable", className: "unknown" };
  const departureUtc = firstText(record.dep_actual_utc, record.dep_estimated_utc, record.dep_time_utc);
  const arrivalUtc = firstText(record.arr_actual_utc, record.arr_estimated_utc, record.arr_time_utc);
  const departureTime = formatAirlabsTime(
    departureUtc || firstText(record.dep_actual, record.dep_estimated, record.dep_time),
  );
  const arrivalTime = formatAirlabsTime(
    arrivalUtc || firstText(record.arr_actual, record.arr_estimated, record.arr_time),
  );

  return {
    flightDate: departureTime?.slice(0, 10) || null,
    flightNumber: firstText(record.flight_iata, requestedFlight),
    airline: text(record.airline_name),
    status: status.label,
    statusClass: status.className,
    departure: mapAirport({
      airport: firstText(record.dep_name, record.dep_iata),
      iata: record.dep_iata,
      terminal: record.dep_terminal,
      gate: record.dep_gate,
      scheduled: departureTime,
      timezone: departureUtc ? "UTC" : null,
      timezoneLabel: departureUtc ? "UTC" : "Airport local",
    }),
    arrival: mapAirport({
      airport: firstText(record.arr_name, record.arr_iata),
      iata: record.arr_iata,
      terminal: record.arr_terminal,
      gate: record.arr_gate,
      scheduled: arrivalTime,
      timezone: arrivalUtc ? "UTC" : null,
      timezoneLabel: arrivalUtc ? "UTC" : "Airport local",
    }),
  };
}

function findAirlabsFlight(payload, requestedFlight) {
  const data = payload?.response ?? payload?.data ?? payload;
  const records = Array.isArray(data) ? data : [data];

  return records.find((record) => normalizeFlightIata(record?.flight_iata) === requestedFlight);
}

async function getCached(cache, key) {
  if (!cache) return null;

  try {
    return await cache.match(key);
  } catch {
    console.warn("Flight lookup cache read failed.");
    return null;
  }
}

async function putCached(cache, key, response) {
  if (!cache) return;

  try {
    await cache.put(key, response.clone());
  } catch {
    console.warn("Flight lookup cache write failed.");
  }
}

async function cacheSuccessfulResponse(cache, key, response) {
  if (response.ok) await putCached(cache, key, response);
  return response;
}

async function lookupAirlabs(flightIata, env, origin) {
  if (!env.AIRLABS_API_KEY) {
    return jsonResponse(
      { error: "Aviationstack's request limit was reached. Configure the AIRLABS_API_KEY Worker secret to enable the free backup." },
      503,
      origin,
    );
  }

  const apiUrl = new URL("https://airlabs.co/api/v9/flight");
  apiUrl.searchParams.set("flight_iata", flightIata);
  apiUrl.searchParams.set("api_key", env.AIRLABS_API_KEY);

  let apiResponse;
  try {
    apiResponse = await fetch(apiUrl);
  } catch {
    return jsonResponse({ error: "Could not connect to the backup flight data provider." }, 502, origin);
  }

  let payload;
  try {
    payload = await apiResponse.json();
  } catch {
    return jsonResponse({ error: "The backup flight data provider returned an invalid response." }, 502, origin);
  }

  if (!apiResponse.ok || payload.error) {
    return jsonResponse(
      { error: "The backup flight data provider rejected the lookup. Check its API key and request allowance." },
      502,
      origin,
    );
  }

  const matchingRecord = findAirlabsFlight(payload, flightIata);
  if (!matchingRecord) {
    return jsonResponse({ error: `No current flight was found for ${flightIata}.` }, 404, origin);
  }

  return jsonResponse({ flight: mapAirlabsFlight(matchingRecord, flightIata) }, 200, origin, 300);
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (origin && !allowedOrigins.has(origin)) {
      return jsonResponse({ error: "This site is not allowed to use the flight lookup." }, 403, origin);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "Only GET requests are supported." }, 405, origin);
    }

    if (requestUrl.pathname !== "/flight") {
      return jsonResponse({ error: "Endpoint not found." }, 404, origin);
    }

    const flightIata = (requestUrl.searchParams.get("flight_iata") || "")
      .toUpperCase()
      .replace(/[\s-]/g, "");

    if (!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(flightIata)) {
      return jsonResponse({ error: "Enter a valid flight number, such as AA100." }, 400, origin);
    }

    if (!env.AVIATIONSTACK_API_KEY && !env.AIRLABS_API_KEY) {
      return jsonResponse({ error: "The flight lookup service is not configured yet." }, 503, origin);
    }

    const cache = globalThis.caches?.default;
    const cacheKey = new Request(
      `${requestUrl.origin}/_cache/flight-v2?flight_iata=${encodeURIComponent(flightIata)}&origin=${encodeURIComponent(origin)}`,
    );
    const cachedResponse = await getCached(cache, cacheKey);
    if (cachedResponse) return cachedResponse;

    if (!env.AVIATIONSTACK_API_KEY) {
      return cacheSuccessfulResponse(
        cache,
        cacheKey,
        await lookupAirlabs(flightIata, env, origin),
      );
    }

    const apiUrl = new URL("https://api.aviationstack.com/v1/flights");
    apiUrl.searchParams.set("access_key", env.AVIATIONSTACK_API_KEY);
    apiUrl.searchParams.set("flight_iata", flightIata);

    let apiResponse;
    try {
      apiResponse = await fetch(apiUrl);
    } catch {
      return jsonResponse({ error: "Could not connect to the flight data provider." }, 502, origin);
    }

    let payload;
    try {
      payload = await apiResponse.json();
    } catch {
      if (apiResponse.status === 429) {
        return cacheSuccessfulResponse(cache, cacheKey, await lookupAirlabs(flightIata, env, origin));
      }

      return jsonResponse({ error: "The flight data provider returned an invalid response." }, 502, origin);
    }

    if (aviationstackLimitReached(apiResponse, payload)) {
      return cacheSuccessfulResponse(cache, cacheKey, await lookupAirlabs(flightIata, env, origin));
    }

    if (!apiResponse.ok || payload.error) {
      return jsonResponse(
        { error: "The flight data provider rejected the lookup. Check the API key, plan, and request limit." },
        502,
        origin,
      );
    }

    if (!Array.isArray(payload.data) || payload.data.length === 0) {
      return jsonResponse({ error: `No current flight was found for ${flightIata}.` }, 404, origin);
    }

    const matchingRecord = payload.data.find((record) =>
      text(record.flight?.iata)?.toUpperCase().replace(/[\s-]/g, "") === flightIata
    );
    if (!matchingRecord) {
      return jsonResponse({ error: `No current flight was found for ${flightIata}.` }, 404, origin);
    }

    const flight = mapFlight(matchingRecord, flightIata);
    const response = jsonResponse({ flight }, 200, origin, 300);
    return cacheSuccessfulResponse(cache, cacheKey, response);
  },
};
