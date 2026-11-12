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
    assert.deepEqual(requestedKey, ["flight:v1:AA100", { type: "json" }]);
    assert.equal(payload.source, "database");
    assert.equal(payload.cacheStored, true);
    assert.equal(payload.flight.flightNumber, "AA100");
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
            assert.equal(key, "flight:v1:AA100");
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
    assert.equal(payload.source, "Aviationstack");
    assert.equal(payload.cacheStored, true);
    assert.equal(storedValue.flight.flightNumber, "AA100");
    assert.deepEqual(storedOptions, { expirationTtl: 300 });
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
            assert.equal(key, "flight:v1:AA100");
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
