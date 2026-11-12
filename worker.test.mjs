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
      { AVIATIONSTACK_API_KEY: "test-key" },
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

test("rejects browser requests from unapproved origins", async () => {
  const response = await worker.fetch(
    new Request("https://flightstatus-api.example.workers.dev/flight?flight_iata=AA100", {
      headers: { Origin: "https://example.com" },
    }),
    { AVIATIONSTACK_API_KEY: "test-key" },
  );

  assert.equal(response.status, 403);
});
