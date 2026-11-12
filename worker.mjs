const allowedOrigins = new Set([
  "https://careerelevate.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

const statusLabels = {
  active: { label: "In flight", className: "in-flight" },
  cancelled: { label: "Cancelled", className: "cancelled" },
  delayed: { label: "Delayed", className: "delayed" },
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

function jsonResponse(body, status, origin) {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");

  return new Response(JSON.stringify(body), { status, headers });
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numeric(value) {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapCoordinates(latitude, longitude) {
  const lat = numeric(latitude);
  const lng = numeric(longitude);
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { latitude: lat, longitude: lng };
}

function mapPosition(latitude, longitude, altitude, updated) {
  const coordinates = mapCoordinates(latitude, longitude);
  const altitudeMeters = numeric(altitude);
  if (!coordinates && altitudeMeters === null) return null;

  return {
    ...(coordinates || {}),
    altitudeMeters,
    updated: text(updated),
  };
}

function delayMinutes(...values) {
  const delays = values.map(numeric).filter((value) => value !== null);
  return delays.length ? Math.max(0, ...delays) : null;
}

function mapAirport(airport) {
  return {
    airport: text(airport?.airport),
    iata: text(airport?.iata),
    terminal: text(airport?.terminal),
    gate: text(airport?.gate),
    scheduled: text(airport?.scheduled),
    estimated: text(airport?.estimated),
    actual: text(airport?.actual),
    timezone: text(airport?.timezone),
    timezoneLabel: text(airport?.timezoneLabel),
    latitude: numeric(airport?.latitude),
    longitude: numeric(airport?.longitude),
  };
}

function mapFlight(record, requestedFlight) {
  const rawStatus = text(record.flight_status)?.toLowerCase() || "unknown";
  const reportedDelay = delayMinutes(record.departure?.delay, record.arrival?.delay);
  const normalizedStatus = rawStatus === "scheduled" && reportedDelay > 0 ? "delayed" : rawStatus;
  const status = statusLabels[normalizedStatus] || { label: "Status unavailable", className: "unknown" };

  return {
    flightDate: text(record.flight_date),
    flightNumber: text(record.flight?.iata) || requestedFlight,
    airline: text(record.airline?.name),
    status: status.label,
    statusClass: status.className,
    delayMinutes: reportedDelay,
    position: mapPosition(
      record.live?.latitude,
      record.live?.longitude,
      record.live?.altitude,
      record.live?.updated,
    ),
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
  const reportedDelay = delayMinutes(record.dep_delayed, record.arr_delayed, record.delayed);
  const normalizedStatus = rawStatus === "en-route"
    ? "active"
    : rawStatus === "on-ground"
      ? "landed"
      : rawStatus === "scheduled" && reportedDelay > 0
        ? "delayed"
      : rawStatus;
  const status = statusLabels[normalizedStatus] || { label: "Status unavailable", className: "unknown" };
  const departureScheduled = formatAirlabsTime(firstText(record.dep_time_utc, record.dep_time));
  const departureEstimated = formatAirlabsTime(firstText(record.dep_estimated_utc, record.dep_estimated));
  const departureActual = formatAirlabsTime(firstText(record.dep_actual_utc, record.dep_actual));
  const arrivalScheduled = formatAirlabsTime(firstText(record.arr_time_utc, record.arr_time));
  const arrivalEstimated = formatAirlabsTime(firstText(record.arr_estimated_utc, record.arr_estimated));
  const arrivalActual = formatAirlabsTime(firstText(record.arr_actual_utc, record.arr_actual));
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
    delayMinutes: reportedDelay,
    position: mapPosition(record.lat, record.lng, record.alt, record.updated),
    departure: mapAirport({
      airport: firstText(record.dep_name, record.dep_iata),
      iata: record.dep_iata,
      terminal: record.dep_terminal,
      gate: record.dep_gate,
      scheduled: departureTime,
      estimated: departureEstimated,
      actual: departureActual,
      timezone: departureUtc ? "UTC" : null,
      timezoneLabel: departureUtc ? "UTC" : "Airport local",
      latitude: record.dep_lat,
      longitude: record.dep_lng,
    }),
    arrival: mapAirport({
      airport: firstText(record.arr_name, record.arr_iata),
      iata: record.arr_iata,
      terminal: record.arr_terminal,
      gate: record.arr_gate,
      scheduled: arrivalTime,
      estimated: arrivalEstimated,
      actual: arrivalActual,
      timezone: arrivalUtc ? "UTC" : null,
      timezoneLabel: arrivalUtc ? "UTC" : "Airport local",
      latitude: record.arr_lat,
      longitude: record.arr_lng,
    }),
  };
}

function findAirlabsFlight(payload, requestedFlight) {
  const data = payload?.response ?? payload?.data ?? payload;
  const records = Array.isArray(data) ? data : [data];

  return records.find((record) => normalizeFlightIata(record?.flight_iata) === requestedFlight);
}

async function getAirportCoordinates(env, airportIata) {
  const code = text(airportIata)?.toUpperCase();
  if (!code || !/^[A-Z]{3}$/.test(code)) return null;

  const cacheKey = `airport:v1:${code}`;
  if (env.FLIGHT_CACHE) {
    try {
      const cached = await env.FLIGHT_CACHE.get(cacheKey, { type: "json" });
      const coordinates = mapCoordinates(cached?.latitude, cached?.longitude);
      if (coordinates) return coordinates;
    } catch (error) {
      console.error(`Airport coordinate cache read failed for ${code}.`, error);
    }
  }

  if (!env.AIRLABS_API_KEY) return null;

  const apiUrl = new URL("https://airlabs.co/api/v9/airports");
  apiUrl.searchParams.set("iata_code", code);
  apiUrl.searchParams.set("api_key", env.AIRLABS_API_KEY);

  let apiResponse;
  try {
    apiResponse = await fetch(apiUrl);
  } catch (error) {
    console.error(`Airport coordinate lookup failed for ${code}.`, error);
    return null;
  }

  let payload;
  try {
    payload = await apiResponse.json();
  } catch (error) {
    console.error(`Airport coordinate response was invalid for ${code}.`, error);
    return null;
  }

  if (!apiResponse.ok || payload.error) {
    console.error(`Airport coordinates were unavailable for ${code}.`);
    return null;
  }

  const data = payload?.response ?? payload?.data ?? payload;
  const records = Array.isArray(data) ? data : [data];
  const airport = records.find((record) => text(record?.iata_code)?.toUpperCase() === code);
  const coordinates = mapCoordinates(airport?.lat, airport?.lng);
  if (!coordinates) return null;

  if (env.FLIGHT_CACHE) {
    try {
      await env.FLIGHT_CACHE.put(cacheKey, JSON.stringify(coordinates), { expirationTtl: 2_592_000 });
    } catch (error) {
      console.error(`Airport coordinates could not be saved for ${code}.`, error);
    }
  }

  return coordinates;
}

function radians(degrees) {
  return degrees * Math.PI / 180;
}

function distanceInKm(from, to) {
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  const clampedHaversine = Math.min(1, Math.max(0, haversine));

  return 6371.0088 * 2 * Math.atan2(
    Math.sqrt(clampedHaversine),
    Math.sqrt(1 - clampedHaversine),
  );
}

function initialBearing(from, to) {
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);

  return Math.atan2(
    Math.sin(longitudeDelta) * Math.cos(toLatitude),
    Math.cos(fromLatitude) * Math.sin(toLatitude)
      - Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(longitudeDelta),
  );
}

function calculateRouteProgress(departure, arrival, position) {
  if (!position || position.latitude === undefined || position.longitude === undefined) return null;

  const totalDistance = distanceInKm(departure, arrival);
  if (totalDistance < 1) return null;

  const earthRadius = 6371.0088;
  const currentDistance = distanceInKm(departure, position);
  const bearingDifference = initialBearing(departure, position) - initialBearing(departure, arrival);
  const alongTrackDistance = Math.atan2(
    Math.sin(currentDistance / earthRadius) * Math.cos(bearingDifference),
    Math.cos(currentDistance / earthRadius),
  ) * earthRadius;
  const distanceCovered = Math.min(totalDistance, Math.max(0, alongTrackDistance));
  const altitudeMeters = numeric(position.altitudeMeters);

  return {
    percentage: Math.round(distanceCovered / totalDistance * 100),
    distanceCoveredMiles: Math.round(distanceCovered * 0.621371),
    distanceRemainingMiles: Math.round((totalDistance - distanceCovered) * 0.621371),
    altitudeFeet: altitudeMeters === null ? null : Math.round(altitudeMeters * 3.28084),
  };
}

async function addRouteProgress(flight, env) {
  if (flight.statusClass === "landed") {
    const altitudeMeters = numeric(flight.position?.altitudeMeters);
    flight.progress = {
      percentage: 100,
      distanceCoveredMiles: null,
      distanceRemainingMiles: 0,
      altitudeFeet: altitudeMeters === null ? null : Math.round(altitudeMeters * 3.28084),
    };
    return;
  }

  if (flight.statusClass !== "in-flight") return;

  if (flight.position?.latitude === undefined || flight.position?.longitude === undefined) {
    flight.progressMessage = "The provider did not return a live aircraft position.";
    return;
  }

  const [departure, arrival] = await Promise.all([
    mapCoordinates(flight.departure.latitude, flight.departure.longitude)
      || getAirportCoordinates(env, flight.departure.iata),
    mapCoordinates(flight.arrival.latitude, flight.arrival.longitude)
      || getAirportCoordinates(env, flight.arrival.iata),
  ]);
  if (!departure || !arrival) {
    flight.progressMessage = env.AIRLABS_API_KEY
      ? "Airport coordinates are unavailable, so route progress cannot be calculated."
      : "Set AIRLABS_API_KEY to look up airport coordinates for route progress.";
    return;
  }

  flight.progress = calculateRouteProgress(departure, arrival, flight.position);
  if (!flight.progress) {
    flight.progressMessage = "Route progress could not be calculated from the available coordinates.";
  }
}

async function getCachedFlight(env, flightIata, origin) {
  if (!env.FLIGHT_CACHE) return null;

  try {
    const cached = await env.FLIGHT_CACHE.get(`flight:v2:${flightIata}`, { type: "json" });
    if (!cached) return null;
    if (!cached.flight) {
      console.error("Stored flight lookup data is invalid.");
      return null;
    }

    return jsonResponse(
      { flight: cached.flight, source: "database", cacheStored: true },
      200,
      origin,
    );
  } catch (error) {
    console.error("Flight KV read failed; querying the flight providers.", error);
    return null;
  }
}

async function responseWithSavedFlight(flight, source, env, flightIata, origin) {
  await addRouteProgress(flight, env);

  let cacheStored = false;
  if (env.FLIGHT_CACHE) {
    try {
      await env.FLIGHT_CACHE.put(
        `flight:v2:${flightIata}`,
        JSON.stringify({ flight }),
        { expirationTtl: 300 },
      );
      cacheStored = true;
    } catch (error) {
      console.error("Flight result could not be saved to KV.", error);
    }
  } else {
    console.error("FLIGHT_CACHE binding is missing; flight result was not saved.");
  }

  return jsonResponse({ flight, source, cacheStored }, 200, origin);
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

  return mapAirlabsFlight(matchingRecord, flightIata);
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

    const cachedResponse = await getCachedFlight(env, flightIata, origin);
    if (cachedResponse) return cachedResponse;

    if (!env.AVIATIONSTACK_API_KEY && !env.AIRLABS_API_KEY) {
      return jsonResponse({ error: "The flight lookup service is not configured yet." }, 503, origin);
    }

    if (!env.AVIATIONSTACK_API_KEY) {
      const backupFlight = await lookupAirlabs(flightIata, env, origin);
      if (backupFlight instanceof Response) return backupFlight;

      return responseWithSavedFlight(
        backupFlight,
        "AirLabs",
        env,
        flightIata,
        origin,
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
        const backupFlight = await lookupAirlabs(flightIata, env, origin);
        if (backupFlight instanceof Response) return backupFlight;

        return responseWithSavedFlight(backupFlight, "AirLabs", env, flightIata, origin);
      }

      return jsonResponse({ error: "The flight data provider returned an invalid response." }, 502, origin);
    }

    if (aviationstackLimitReached(apiResponse, payload)) {
      const backupFlight = await lookupAirlabs(flightIata, env, origin);
      if (backupFlight instanceof Response) return backupFlight;

      return responseWithSavedFlight(backupFlight, "AirLabs", env, flightIata, origin);
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
    return responseWithSavedFlight(flight, "Aviationstack", env, flightIata, origin);
  },
};
