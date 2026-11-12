const liveFlightForm = document.querySelector("#live-flight-form");
const liveFlightInput = document.querySelector("#live-flight-number");
const lookupMessage = document.querySelector("#lookup-message");
const liveResult = document.querySelector("#live-result");
const lookupButton = liveFlightForm.querySelector("button");

function addDetail(parent, label, value) {
  const detail = document.createElement("div");
  detail.className = "live-detail";

  const heading = document.createElement("span");
  heading.className = "live-detail-label";
  heading.textContent = label;

  const text = document.createElement("span");
  text.className = "live-detail-value";
  text.textContent = value || "Not available";

  detail.append(heading, text);
  parent.append(detail);
}

function formatFlightTime(value, timezone) {
  if (!value) return "Not available";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";

  const options = { dateStyle: "medium", timeStyle: "short" };
  if (timezone) options.timeZone = timezone;

  try {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }
}

function renderLiveFlight(flight) {
  liveResult.replaceChildren();

  const heading = document.createElement("div");
  heading.className = "live-result-heading";

  const identity = document.createElement("div");
  const airline = document.createElement("span");
  airline.className = "live-airline";
  airline.textContent = flight.airline || "Airline";
  const flightNumber = document.createElement("span");
  flightNumber.className = "live-flight-number";
  flightNumber.textContent = flight.flightNumber;
  identity.append(airline, flightNumber);

  const status = document.createElement("span");
  status.className = `live-status live-status--${flight.statusClass}`;
  status.textContent = flight.status;
  heading.append(identity, status);

  const route = document.createElement("div");
  route.className = "live-route";
  addDetail(route, "FROM", [flight.departure.airport, flight.departure.iata].filter(Boolean).join(" · "));
  addDetail(route, "TO", [flight.arrival.airport, flight.arrival.iata].filter(Boolean).join(" · "));

  const schedule = document.createElement("div");
  schedule.className = "live-route";
  const departureLabel = flight.departure.timezoneLabel
    ? `DEPARTURE (${flight.departure.timezoneLabel})`
    : "DEPARTURE";
  const arrivalLabel = flight.arrival.timezoneLabel
    ? `ARRIVAL (${flight.arrival.timezoneLabel})`
    : "ARRIVAL";
  addDetail(schedule, departureLabel, formatFlightTime(flight.departure.scheduled, flight.departure.timezone));
  addDetail(schedule, arrivalLabel, formatFlightTime(flight.arrival.scheduled, flight.arrival.timezone));

  const details = document.createElement("div");
  details.className = "live-route";
  addDetail(details, "DEPARTURE GATE", [flight.departure.terminal, flight.departure.gate].filter(Boolean).join(" · "));
  addDetail(details, "ARRIVAL GATE", [flight.arrival.terminal, flight.arrival.gate].filter(Boolean).join(" · "));

  liveResult.append(heading, route, schedule, details);
  liveResult.hidden = false;
}

liveFlightForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  liveResult.hidden = true;

  const flightIata = liveFlightInput.value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(flightIata)) {
    lookupMessage.textContent = "Enter a valid flight number, such as AA100.";
    return;
  }

  const apiUrl = window.FLIGHT_STATUS_API_URL;
  if (!apiUrl) {
    lookupMessage.textContent = "Live lookup is not configured yet. Follow the setup steps in the project README.";
    return;
  }

  lookupButton.disabled = true;
  lookupMessage.textContent = "Checking flight status…";

  try {
    const endpoint = new URL("/flight", apiUrl);
    endpoint.searchParams.set("flight_iata", flightIata);
    const response = await fetch(endpoint, { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Flight status could not be loaded.");
    }

    renderLiveFlight(payload.flight);
    const cacheMessage = payload.source === "database"
      ? "Loaded from saved data."
      : payload.cacheStored
        ? "Saved for reuse for 5 minutes."
        : "Could not save this result; another request may be needed next time.";
    lookupMessage.textContent = `Status for ${payload.flight.flightNumber} · flight date ${payload.flight.flightDate || "not available"} · ${cacheMessage}`;
  } catch (error) {
    lookupMessage.textContent = error instanceof TypeError
      ? "Could not connect to the flight service. Please try again later."
      : error.message;
  } finally {
    lookupButton.disabled = false;
  }
});

const timeElement = document.querySelector("#current-time");
const updateLocalTime = () => {
  timeElement.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
};

updateLocalTime();
setInterval(updateLocalTime, 60_000);
