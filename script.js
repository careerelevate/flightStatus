const liveFlightForm = document.querySelector("#live-flight-form");
const liveFlightInput = document.querySelector("#live-flight-number");
const lookupMessage = document.querySelector("#lookup-message");
const liveResult = document.querySelector("#live-result");
const flightVisual = document.querySelector("#flight-visual");
const runwayCaption = document.querySelector("#runway-caption");
const runwayState = document.querySelector("#runway-state");
const runwayTrack = document.querySelector("#runway-track");
const runwayFill = document.querySelector("#runway-fill");
const runwayPlane = document.querySelector("#runway-plane");
const runwayCancelled = document.querySelector("#runway-cancelled");
const runwayOrigin = document.querySelector("#runway-origin");
const runwayDestination = document.querySelector("#runway-destination");
const runwayMetrics = document.querySelector("#runway-metrics");
const runwayNote = document.querySelector("#runway-note");
const arrivalCountdown = document.querySelector("#arrival-countdown");
const arrivalTime = document.querySelector("#arrival-time");
const arrivalDelay = document.querySelector("#arrival-delay");
const lookupButton = liveFlightForm.querySelector("button");
let arrivalCountdownTarget = null;

function formatAirport(airport, fallback) {
  return airport.iata || airport.airport || fallback;
}

function renderFlightVisual(flight) {
  const delayMinutes = Number.isFinite(flight.delayMinutes) ? flight.delayMinutes : null;
  const isCancelled = flight.statusClass === "cancelled";
  let color = "neutral";
  let statusText = "Delay information unavailable";

  if (isCancelled) {
    color = "cancelled";
    statusText = "CANCELLED";
  } else if (flight.statusClass === "delayed" && delayMinutes === null) {
    color = "yellow";
    statusText = "Delayed";
  } else if (flight.statusClass === "scheduled" && delayMinutes === null) {
    color = "green";
    statusText = "On schedule";
  } else if (delayMinutes !== null && delayMinutes === 0) {
    color = "green";
    statusText = "On time";
  } else if (delayMinutes !== null && delayMinutes <= 30) {
    color = "yellow";
    statusText = `Delayed ${delayMinutes} min`;
  } else if (delayMinutes !== null && delayMinutes <= 120) {
    color = "red";
    statusText = `Delayed ${delayMinutes} min`;
  } else if (delayMinutes !== null) {
    color = "purple";
    statusText = `Delayed ${delayMinutes} min`;
  }

  const progress = flight.progress;
  const percentage = Number.isFinite(progress?.percentage)
    ? Math.max(0, Math.min(100, progress.percentage))
    : flight.statusClass === "landed"
      ? 100
      : 0;
  const showPlane = !isCancelled && (
    flight.statusClass === "scheduled"
    || flight.statusClass === "delayed"
    || flight.statusClass === "in-flight" && Number.isFinite(progress?.percentage)
    || flight.statusClass === "landed"
  );
  const departure = formatAirport(flight.departure, "Origin");
  const arrival = formatAirport(flight.arrival, "Destination");

  runwayCaption.textContent = `${departure} to ${arrival}`;
  runwayState.className = `runway-state runway-state--${color}`;
  runwayState.textContent = statusText;
  runwayTrack.className = `runway-track runway-track--${color}`;
  runwayTrack.setAttribute(
    "aria-label",
    isCancelled
      ? `Flight cancelled between ${departure} and ${arrival}`
      : `Flight from ${departure} to ${arrival}${progress ? `, ${percentage}% complete` : ""}`,
  );
  runwayFill.style.width = isCancelled ? "0%" : `${percentage}%`;
  runwayPlane.style.setProperty("--progress", `${percentage}%`);
  runwayPlane.hidden = !showPlane;
  runwayCancelled.hidden = !isCancelled;
  runwayOrigin.textContent = departure;
  runwayDestination.textContent = arrival;

  const altitude = Number.isFinite(progress?.altitudeFeet)
    ? `${progress.altitudeFeet.toLocaleString()} ft`
    : Number.isFinite(flight.position?.altitudeMeters)
      ? `${Math.round(flight.position.altitudeMeters * 3.28084).toLocaleString()} ft`
      : null;
  if (progress && flight.statusClass !== "landed") {
    runwayMetrics.textContent = [
      `${progress.distanceCoveredMiles.toLocaleString()} mi covered`,
      `${progress.distanceRemainingMiles.toLocaleString()} mi remaining`,
      altitude ? `Altitude ${altitude}` : null,
    ].filter(Boolean).join(" · ");
  } else if (flight.statusClass === "landed") {
    runwayMetrics.textContent = `Landed at ${arrival}${altitude ? ` · Altitude ${altitude}` : ""}`;
  } else if (isCancelled) {
    runwayMetrics.textContent = "This flight will not operate.";
  } else if (flight.statusClass === "in-flight") {
    runwayMetrics.textContent = altitude
      ? `Altitude ${altitude} · Route progress unavailable`
      : "Live aircraft position unavailable.";
  } else if (showPlane) {
    runwayMetrics.textContent = "Aircraft has not departed.";
  } else {
    runwayMetrics.textContent = "";
  }

  const note = flight.progressMessage;
  runwayNote.textContent = note || "";
  runwayNote.hidden = !note;
  flightVisual.hidden = false;
}

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

function formatTimeToArrival(target) {
  const remainingMilliseconds = target.getTime() - Date.now();
  if (remainingMilliseconds <= 0) return "Arrival time passed";

  const remainingMinutes = Math.ceil(remainingMilliseconds / 60_000);
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes} min`;
}

function updateArrivalSummary(flight) {
  const arrival = flight.arrival || {};
  const isCancelled = flight.statusClass === "cancelled";
  const isLanded = flight.statusClass === "landed";
  const estimatedDate = arrival.estimated ? new Date(arrival.estimated) : null;
  const scheduledDate = arrival.scheduled ? new Date(arrival.scheduled) : null;
  const hasEstimatedDate = estimatedDate && !Number.isNaN(estimatedDate.getTime());
  const validScheduledDate = scheduledDate && !Number.isNaN(scheduledDate.getTime());
  const baseArrivalDate = hasEstimatedDate ? estimatedDate : validScheduledDate ? scheduledDate : null;
  const targetDate = baseArrivalDate
    ? new Date(baseArrivalDate.getTime() + (
      !hasEstimatedDate && Number.isFinite(flight.delayMinutes)
        ? flight.delayMinutes * 60_000
        : 0
    ))
    : null;

  arrivalCountdownTarget = null;
  if (isCancelled) {
    arrivalCountdown.textContent = "Cancelled";
    arrivalTime.textContent = "No arrival";
    arrivalDelay.textContent = "Flight cancelled";
  } else if (isLanded) {
    arrivalCountdown.textContent = "Arrived";
    arrivalTime.textContent = arrival.actual
      ? `Arrived ${formatFlightTime(arrival.actual, arrival.timezone)}`
      : "Flight has landed";
    arrivalDelay.textContent = Number.isFinite(flight.delayMinutes) && flight.delayMinutes > 0
      ? `${flight.delayMinutes} min${flight.delayMinutes === 1 ? "" : "s"} delay`
      : flight.delayMinutes === 0
        ? "On time"
        : "Delay not reported";
  } else {
    arrivalCountdownTarget = targetDate;
    arrivalCountdown.textContent = targetDate ? formatTimeToArrival(targetDate) : "Not available";
    arrivalTime.textContent = targetDate
      ? `${hasEstimatedDate ? "Estimated" : "Scheduled"} arrival ${formatFlightTime(targetDate, arrival.timezone)}`
      : "Arrival time not available";
    arrivalDelay.textContent = Number.isFinite(flight.delayMinutes) && flight.delayMinutes > 0
      ? `${flight.delayMinutes} min${flight.delayMinutes === 1 ? "" : "s"} delay`
      : flight.delayMinutes === 0
        ? "On time"
        : flight.statusClass === "delayed"
          ? "Delay amount not available"
          : "Not reported";
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
  renderFlightVisual(flight);
  updateArrivalSummary(flight);
}

liveFlightForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  liveResult.hidden = true;
  flightVisual.hidden = true;

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
  if (arrivalCountdownTarget) {
    arrivalCountdown.textContent = formatTimeToArrival(arrivalCountdownTarget);
  }
};

updateLocalTime();
setInterval(updateLocalTime, 60_000);
