import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.mjs";

const origin = "https://careerelevate.github.io";

test("reports missing Aviationstack credentials explicitly", async () => {
  const response = await worker.fetch(
    new Request("https://flightstatus-api.example.workers.dev/flight?flight_iata=AA100"),
    {},
  );

  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/i);
});

test("serves saved flight details from KV without calling a flight provider", async () => {
  const originalFetch = globalThis.fetch;
  let requestedKey;
  globalThis.fetch = () => {
    throw new Error("A provider should not be called for a KV hit.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://flightstatus-api.example.workers.dev/flight?flight_iata=AA100"),
      {
        FLIGHT_CACHE: {
          get: async (key, options) => {
            requestedKey = [key, options];
            return { flight: { flightNumber: "AA100", flightDate: "2026-11-12" } };
          },
        },
      },
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(requestedKey, ["flight:v2:AA100", { type: "json" }]);
    assert.equal(payload.source, "database");
    assert.equal(payload.cacheStored, true);
    assert.equal(payload.flight.flightNumber, "AA100");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refresh requests bypass the saved flight result and store fresh provider data", async () => {
  const originalFetch = globalThis.fetch;
  let storedFlight;
  globalThis.fetch = async (input) => {
    assert.equal(new URL(input).searchParams.get("flight_iata"), "AA100");
    return new Response(JSON.stringify({
      data: [{
        flight_status: "active",
        flight: { iata: "AA100" },
        departure: { iata: "AAA", latitude: 0, longitude: 0 },
        arrival: { iata: "BBB", latitude: 0, longitude: 10 },
        live: { latitude: 0, longitude: 6, altitude: 10000 },
      }],
    }), { status: 200 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://flightstatus-api.example.workers.dev/flight?flight_iata=AA100&refresh=true"),
      {
        AVIATIONSTACK_API_KEY: "test-key",
        FLIGHT_CACHE: {
          get: async () => {
            throw new Error("A refresh must not read the previous saved flight.");
          },
          put: async (key, value) => {
            assert.equal(key, "flight:v2:AA100");
            storedFlight = JSON.parse(value).flight;
          },
        },
      },
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.source, "Aviationstack");
    assert.equal(payload.flight.progress.percentage, 60);
    assert.equal(storedFlight.progress.percentage, 60);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects malformed flight numbers without calling the provider", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Provider should not be called for invalid input.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://flightstatus-api.example.workers.dev/flight?flight_iata=AA"),
      { AVIATIONSTACK_API_KEY: "test-key" },
    );

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /valid flight number/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps Aviationstack flight data and allows the published site origin", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  let storedValue;
  let storedOptions;
  globalThis.fetch = async (input) => {
    requestedUrl = new URL(input);
    return new Response(JSON.stringify({
      data: [{
        flight_date: "2026-11-11",
        flight_status: "active",
        airline: { name: "Example Air" },
        flight: { iata: "AA100" },
        departure: {
          airport: "John F Kennedy International",
          iata: "JFK",
          terminal: "4",
          gate: "B22",
          scheduled: "2026-11-11T18:00:00-05:00",
          timezone: "America/New_York",
        },
        arrival: {
          airport: "Los Angeles International",
          iata: "LAX",
          scheduled: "2026-11-11T21:15:00-08:00",
          estimated: "2026-11-11T21:45:00-08:00",
          actual: null,
          timezone: "America/Los_Angeles",
        },
      }],
    }), { status: 200 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://flightstatus-api.example.workers.dev/flight?flight_iata=aa-100", {
        headers: { Origin: origin },
      }),
      {
        AVIATIONSTACK_API_KEY: "test-key",
        FLIGHT_CACHE: {
          get: async () => null,
          put: async (key, value, options) => {
            assert.equal(key, "flight:v2:AA100");
            storedValue = JSON.parse(value);
            storedOptions = options;
          },
        },
      },
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal(requestedUrl.searchParams.get("flight_iata"), "AA100");
    assert.equal(requestedUrl.searchParams.get("access_key"), "test-key");
    assert.equal(payload.flight.flightNumber, "AA100");
    assert.equal(payload.flight.status, "In flight");
    assert.equal(payload.flight.departure.iata, "JFK");
    assert.equal(payload.flight.arrival.iata, "LAX");
    assert.equal(payload.flight.arrival.estimated, "2026-11-11T21:45:00-08:00");
    assert.equal(payload.flight.arrival.actual, null);
    assert.equal(payload.source, "Aviationstack");
    assert.equal(payload.cacheStored, true);
    assert.equal(storedValue.flight.flightNumber, "AA100");
    assert.deepEqual(storedOptions, { expirationTtl: 300 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps delay and calculates route progress for an airborne flight", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{
      flight_status: "active",
      flight: { iata: "AA100" },
      departure: { iata: "AAA", latitude: 0, longitude: 0, delay: 0 },
      arrival: { iata: "BBB", latitude: 0, longitude: 10 },
      live: { latitude: 0, longitude: 5, altitude: 10000 },
    }],
  }), { status: 200 });

  try {
    const response = await worker.fetch(
      new Request("https://flightstatus-api.example.workers.dev/flight?flight_iata=AA100"),
      { AVIATIONSTACK_API_KEY: "test-key" },
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.flight.delayMinutes, 0);
    assert.equal(payload.flight.progress.percentage, 50);
    assert.equal(payload.flight.progress.distanceCoveredMiles, 345);
    assert.equal(payload.flight.progress.distanceRemainingMiles, 345);
    assert.equal(payload.flight.progress.altitudeFeet, 32808);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("looks up and caches airport coordinates when a flight omits them", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  const storedEntries = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requestedUrls.push(url);

    if (url.hostname === "api.aviationstack.com") {
      return new Response(JSON.stringify({
        data: [{
          flight_status: "active",
          flight: { iata: "AA100" },
          departure: { iata: "JFK" },
          arrival: { iata: "LAX" },
          live: { latitude: 39, longitude: -98 },
        }],
      }), { status: 200 });
    }

    const airportCoordinates = {
      JFK: { lat: 40.6413, lng: -73.7781 },
      LAX: { lat: 33.9416, lng: -118.4085 },
    };
    const code = url.searchParams.get("iata_code");
    return new Response(JSON.stringify({
      response: [{ iata_code: code, ...airportCoordinates[code] }],
    }), { status: 200 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://flightstatus-api.example.workers.dev/flight?flight_iata=AA100"),
      {
        AVIATIONSTACK_API_KEY: "test-key",
        AIRLABS_API_KEY: "airlabs-key",
        FLIGHT_CACHE: {
          get: async () => null,
          put: async (key, value, options) => storedEntries.push({
            key,
            value: JSON.parse(value),
            options,
          }),
        },
      },
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(requestedUrls.length, 3);
    assert.deepEqual(
      requestedUrls.slice(1).map((url) => url.searchParams.get("iata_code")).sort(),
      ["JFK", "LAX"],
    );
    assert.ok(payload.flight.progress.percentage > 0);
    assert.ok(payload.flight.progress.percentage < 100);
    assert.deepEqual(
      storedEntries.filter((entry) => entry.key.startsWith("airport:v1:"))
        .map((entry) => entry.options.expirationTtl)
        .sort(),
      [2_592_000, 2_592_000],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports missing aircraft position and handles landed or cancelled flights", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const flightIata = new URL(input).searchParams.get("flight_iata");
    const status = {
      AA100: "active",
      AA101: "landed",
      AA102: "cancelled",
    }[flightIata];
    return new Response(JSON.stringify({
      data: [{
        flight_status: status,
        flight: { iata: flightIata },
        departure: { iata: "JFK" },
        arrival: { iata: "LAX" },
      }],
    }), { status: 200 });
  };

  try {
    const lookup = (flightIata) => worker.fetch(
      new Request(`https://flightstatus-api.example.workers.dev/flight?flight_iata=${flightIata}`),
      { AVIATIONSTACK_API_KEY: "test-key" },
    );
    const activeResponse = await lookup("AA100");
    const landedResponse = await lookup("AA101");
    const cancelledResponse = await lookup("AA102");
    const active = await activeResponse.json();
    const landed = await landedResponse.json();
    const cancelled = await cancelledResponse.json();

    assert.equal(active.flight.progress, undefined);
    assert.match(active.flight.progressMessage, /did not return a live aircraft position/i);
    assert.equal(landed.flight.progress.percentage, 100);
    assert.equal(cancelled.flight.status, "Cancelled");
    assert.equal(cancelled.flight.statusClass, "cancelled");
    assert.equal(cancelled.flight.progress, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns a live result but reports when KV could not save it", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{
      flight_status: "scheduled",
      flight: { iata: "AA100" },
    }],
  }), { status: 200 });

  try {
    const response = await worker.fetch(
      new Request("https://flightstatus-api.example.workers.dev/flight?flight_iata=AA100"),
      {
        AVIATIONSTACK_API_KEY: "test-key",
        FLIGHT_CACHE: {
          get: async () => null,
          put: async () => {
            throw new Error("KV unavailable");
          },
        },
      },
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.flight.flightNumber, "AA100");
    assert.equal(payload.cacheStored, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not return an unrelated flight when the provider result does not match", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{
      flight: { iata: "UL2026" },
    }],
  }), { status: 200 });

  try {
    const response = await worker.fetch(
      new Request("https://flightstatus-api.example.workers.dev/flight?flight_iata=AA100"),
      { AVIATIONSTACK_API_KEY: "test-key" },
    );

    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /No current flight was found for AA100/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses AirLabs when Aviationstack reports its request limit was reached", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  let storedFlight;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requestedUrls.push(url);

    if (url.hostname === "api.aviationstack.com") {
      return new Response(JSON.stringify({
        error: {
          code: "usage_limit_reached",
          message: "Your monthly usage limit has been reached.",
        },
      }), { status: 200 });
    }

    return new Response(JSON.stringify({
      response: {
        flight_iata: "AA100",
        airline_name: "American Airlines",
        status: "en-route",
        dep_iata: "JFK",
        dep_name: "John F Kennedy International",
        dep_terminal: "4",
        dep_gate: "B22",
        dep_time_utc: "2026-11-12 18:00",
        arr_iata: "LAX",
        arr_name: "Los Angeles International",
        arr_time_utc: "2026-11-12 21:15",
        arr_estimated_utc: "2026-11-12 21:45",
      },
    }), { status: 200 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://flightstatus-api.example.workers.dev/flight?flight_iata=AA100"),
      {
        AVIATIONSTACK_API_KEY: "aviationstack-key",
        AIRLABS_API_KEY: "airlabs-key",
        FLIGHT_CACHE: {
          get: async () => null,
          put: async (key, value) => {
            assert.equal(key, "flight:v2:AA100");
            storedFlight = JSON.parse(value).flight;
          },
        },
      },
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(requestedUrls.length, 2);
    assert.equal(requestedUrls[0].searchParams.get("access_key"), "aviationstack-key");
    assert.equal(requestedUrls[1].hostname, "airlabs.co");
    assert.equal(requestedUrls[1].pathname, "/api/v9/flight");
    assert.equal(requestedUrls[1].searchParams.get("flight_iata"), "AA100");
    assert.equal(requestedUrls[1].searchParams.get("api_key"), "airlabs-key");
    assert.equal(payload.flight.flightNumber, "AA100");
    assert.equal(payload.flight.airline, "American Airlines");
    assert.equal(payload.flight.status, "In flight");
    assert.equal(payload.flight.departure.scheduled, "2026-11-12T18:00:00Z");
    assert.equal(payload.flight.departure.timezoneLabel, "UTC");
    assert.equal(payload.flight.arrival.iata, "LAX");
    assert.equal(payload.flight.arrival.estimated, "2026-11-12T21:45:00Z");
    assert.equal(payload.source, "AirLabs");
    assert.equal(payload.cacheStored, true);
    assert.equal(storedFlight.flightNumber, "AA100");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not use AirLabs for non-quota Aviationstack errors", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({
      error: { code: "invalid_access_key", message: "Invalid API access key." },
    }), { status: 401 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://flightstatus-api.example.workers.dev/flight?flight_iata=AA100"),
      { AVIATIONSTACK_API_KEY: "invalid-key", AIRLABS_API_KEY: "airlabs-key" },
    );

    assert.equal(response.status, 502);
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports that AirLabs must be configured when Aviationstack's quota is exhausted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "usage_limit_reached", message: "Monthly usage limit reached." },
  }), { status: 200 });

  try {
    const response = await worker.fetch(
      new Request("https://flightstatus-api.example.workers.dev/flight?flight_iata=AA100"),
      { AVIATIONSTACK_API_KEY: "test-key" },
    );

    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /AIRLABS_API_KEY/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects browser requests from unapproved origins", async () => {
  const response = await worker.fetch(
    new Request("https://flightstatus-api.example.workers.dev/flight?flight_iata=AA100", {
      headers: { Origin: "https://example.com" },
    }),
    { AVIATIONSTACK_API_KEY: "test-key" },
  );

  assert.equal(response.status, 403);
});
