const liveFlightForm = document.querySelector("#live-flight-form");
const flightNumberList = document.querySelector("#flight-number-list");
const flightInputTemplate = document.querySelector("#flight-input-template");
const addFlightButton = document.querySelector("#add-flight");
const lookupMessage = document.querySelector("#lookup-message");
const liveResult = document.querySelector("#live-result");
const flightVisual = document.querySelector("#flight-visual");
const flightVisualList = document.querySelector("#flight-visual-list");
const flightVisualTemplate = document.querySelector("#flight-visual-template");
const lookupButton = liveFlightForm.querySelector('button[type="submit"]');
const maxFlightLegs = 4;
let activeFlights = [];

function formatAirport(airport, fallback) {
  return airport.iata || airport.airport || fallback;
}

function renderFlightVisual(flight, flightIndex) {
  const visual = flightVisualTemplate.content.firstElementChild.cloneNode(true);
  const query = (selector) => visual.querySelector(selector);
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

  query(".runway-caption").textContent = `Flight ${flight.flightNumber}: ${departure} to ${arrival}`;
  const runwayState = query(".runway-state");
  runwayState.className = `runway-state runway-state--${color}`;
  runwayState.textContent = statusText;
  const runwayTrack = query(".runway-track");
  runwayTrack.className = `runway-track runway-track--${color}`;
  runwayTrack.setAttribute(
    "aria-label",
    isCancelled
      ? `Flight cancelled between ${departure} and ${arrival}`
      : `Flight from ${departure} to ${arrival}${progress ? `, ${percentage}% complete` : ""}`,
  );
  query(".runway-fill").style.width = isCancelled ? "0%" : `${percentage}%`;
  const runwayPlane = query(".runway-plane");
  runwayPlane.style.setProperty("--progress", `${percentage}%`);
  runwayPlane.hidden = !showPlane;
  query(".runway-cancelled").hidden = !isCancelled;
  query(".runway-origin").textContent = departure;
  query(".runway-destination").textContent = arrival;

  const altitude = Number.isFinite(progress?.altitudeFeet)
    ? `${progress.altitudeFeet.toLocaleString()} ft`
    : Number.isFinite(flight.position?.altitudeMeters)
      ? `${Math.round(flight.position.altitudeMeters * 3.28084).toLocaleString()} ft`
      : null;
  const runwayMetrics = query(".runway-metrics");
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
  const runwayNote = query(".runway-note");
  runwayNote.textContent = note || "";
  runwayNote.hidden = !note;
  query(".flight-refresh").dataset.flightIndex = String(flightIndex);
  updateArrivalSummary(flight, visual);
  return visual;
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

function updateArrivalSummary(flight, visual) {
  const arrivalCountdown = visual.querySelector(".arrival-countdown");
  const arrivalTime = visual.querySelector(".arrival-time");
  const arrivalDelay = visual.querySelector(".arrival-delay");
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

  delete arrivalCountdown.dataset.targetTime;
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
    if (targetDate) arrivalCountdown.dataset.targetTime = String(targetDate.getTime());
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

function renderLiveFlight(flight, flightIndex) {
  const result = document.createElement("article");
  result.className = "live-result";
  const heading = document.createElement("div");
  heading.className = "live-result-heading";

  const identity = document.createElement("div");
  const airline = document.createElement("span");
  airline.className = "live-airline";
  airline.textContent = flight.airline || "Airline";
  const flightNumber = document.createElement("span");
  flightNumber.className = "live-flight-number";
  flightNumber.textContent = `Leg ${flightIndex + 1} · ${flight.flightNumber}`;
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

  result.append(heading, route, schedule, details);
  return result;
}

function setLookupBusy(isBusy) {
  lookupButton.disabled = isBusy;
  addFlightButton.disabled = isBusy || flightNumberList.children.length >= maxFlightLegs;
  flightNumberList.querySelectorAll("input, .remove-flight").forEach((control) => {
    control.disabled = isBusy;
  });
  flightVisualList.querySelectorAll(".flight-refresh").forEach((button) => {
    button.disabled = isBusy;
  });
}

function updateFlightInputRows() {
  const rows = [...flightNumberList.querySelectorAll(".flight-number-row")];
  rows.forEach((row, index) => {
    const input = row.querySelector("input");
    const label = row.querySelector("label");
    const removeButton = row.querySelector(".remove-flight");
    input.id = `flight-number-${index + 1}`;
    label.htmlFor = input.id;
    label.textContent = `Flight ${index + 1} number`;
    removeButton.hidden = rows.length === 1;
    removeButton.setAttribute("aria-label", `Remove flight ${index + 1}`);
  });
  addFlightButton.disabled = rows.length >= maxFlightLegs;
}

function validFlightNumber(value) {
  return /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(value);
}

async function fetchFlightStatus(flightIata, refresh = false) {
  const apiUrl = window.FLIGHT_STATUS_API_URL;
  if (!apiUrl) {
    throw new Error("Live lookup is not configured yet. Follow the setup steps in the project README.");
  }

  const endpoint = new URL("/flight", apiUrl);
  endpoint.searchParams.set("flight_iata", flightIata);
  if (refresh) endpoint.searchParams.set("refresh", "true");
  const response = await fetch(endpoint, { cache: "no-store" });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Flight status could not be loaded.");
  }

  return payload;
}

function errorMessage(error) {
  return error instanceof TypeError
    ? "Could not connect to the flight service. Please try again later."
    : error.message;
}

function createFlightError(entry, index) {
  const error = document.createElement("article");
  error.className = "live-result live-result--error";
  const heading = document.createElement("strong");
  heading.textContent = `Leg ${index + 1} · ${entry.flightIata}`;
  const message = document.createElement("p");
  message.textContent = errorMessage(entry.error);
  error.append(heading, message);
  return error;
}

function flightEndpointDate(airport, fields) {
  for (const field of fields) {
    if (!airport?.[field]) continue;
    const date = new Date(airport[field]);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function airportIdentity(airport) {
  return {
    iata: airport?.iata?.trim().toUpperCase() || null,
    name: airport?.airport?.trim().toLowerCase() || null,
  };
}

function sameAirport(first, second) {
  const firstIdentity = airportIdentity(first);
  const secondIdentity = airportIdentity(second);
  if (firstIdentity.iata && secondIdentity.iata) {
    return firstIdentity.iata === secondIdentity.iata;
  }
  if (firstIdentity.name && secondIdentity.name) {
    return firstIdentity.name === secondIdentity.name;
  }
  return null;
}

function formatLayoverDuration(minutes) {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  return [
    days ? `${days}d` : null,
    hours ? `${hours}h` : null,
    remainingMinutes ? `${remainingMinutes}m` : null,
  ].filter(Boolean).join(" ") || "Less than 1m";
}

function createLayoverCard(previous, next, index) {
  const card = document.createElement("article");
  card.className = "layover-card";
  const heading = document.createElement("p");
  heading.className = "eyebrow";
  heading.textContent = "LAYOVER";
  const description = document.createElement("p");
  description.className = "layover-description";
  const duration = document.createElement("strong");
  duration.className = "layover-duration";

  if (previous.flight.statusClass === "cancelled" || next.flight.statusClass === "cancelled") {
    card.classList.add("layover-card--warning");
    description.textContent = `Connection between legs ${index + 1} and ${index + 2} includes a cancelled flight.`;
    duration.textContent = "Layover unavailable";
  } else {
    const arrivalAirport = previous.flight.arrival;
    const departureAirport = next.flight.departure;
    const airportMatches = sameAirport(arrivalAirport, departureAirport);

    if (airportMatches === false) {
      card.classList.add("layover-card--warning");
      description.textContent = `Leg ${index + 1} arrives at ${formatAirport(arrivalAirport, "unknown airport")}; leg ${index + 2} departs from ${formatAirport(departureAirport, "unknown airport")}.`;
      duration.textContent = "Connection airport mismatch";
    } else if (airportMatches === null) {
      card.classList.add("layover-card--warning");
      description.textContent = `Airport details are unavailable for the connection between legs ${index + 1} and ${index + 2}.`;
      duration.textContent = "Layover unavailable";
    } else {
      const arrivalDate = flightEndpointDate(arrivalAirport, ["actual", "estimated", "scheduled"]);
      const departureDate = flightEndpointDate(departureAirport, ["actual", "estimated", "scheduled"]);
      const layoverMinutes = arrivalDate && departureDate
        ? Math.round((departureDate.getTime() - arrivalDate.getTime()) / 60_000)
        : null;

      description.textContent = `Leg ${index + 1} to leg ${index + 2} · ${formatAirport(arrivalAirport, "Airport unavailable")}`;
      if (layoverMinutes === null) {
        card.classList.add("layover-card--warning");
        duration.textContent = "Layover time unavailable";
      } else if (layoverMinutes < 0) {
        card.classList.add("layover-card--warning");
        duration.textContent = "Check flight order and times";
      } else {
        duration.textContent = `${formatLayoverDuration(layoverMinutes)} between flights`;
      }
    }
  }

  card.append(heading, description, duration);
  return card;
}

function createUnavailableConnection(index) {
  const card = document.createElement("article");
  card.className = "layover-card layover-card--warning";
  const heading = document.createElement("p");
  heading.className = "eyebrow";
  heading.textContent = "LAYOVER";
  const description = document.createElement("p");
  description.className = "layover-description";
  description.textContent = `Could not calculate the connection between legs ${index + 1} and ${index + 2} because a flight lookup failed.`;
  card.append(heading, description);
  return card;
}

function renderItinerary(entries) {
  liveResult.replaceChildren();
  flightVisualList.replaceChildren();
  let successfulFlights = 0;

  entries.forEach((entry, index) => {
    if (entry.flight) {
      successfulFlights += 1;
      liveResult.append(renderLiveFlight(entry.flight, index));
      flightVisualList.append(renderFlightVisual(entry.flight, index));
    } else {
      liveResult.append(createFlightError(entry, index));
      const missingLeg = document.createElement("p");
      missingLeg.className = "itinerary-leg-error";
      missingLeg.textContent = `Flight ${index + 1} (${entry.flightIata}) could not be shown on the route.`;
      flightVisualList.append(missingLeg);
    }

    if (index < entries.length - 1) {
      const next = entries[index + 1];
      flightVisualList.append(
        entry.flight && next.flight
          ? createLayoverCard(entry, next, index)
          : createUnavailableConnection(index),
      );
    }
  });

  liveResult.hidden = false;
  flightVisual.hidden = successfulFlights === 0;
  return successfulFlights;
}

function lookupStatusMessage(entries, successfulFlights) {
  if (successfulFlights === entries.length) {
    if (entries.length === 1) {
      const entry = entries[0];
      const cacheMessage = entry.source === "database"
        ? "Loaded from saved data."
        : entry.cacheStored
          ? "Saved for reuse for 5 minutes."
          : "Could not save this result; another request may be needed next time.";
      return `Status for ${entry.flight.flightNumber} · flight date ${entry.flight.flightDate || "not available"} · ${cacheMessage}`;
    }
    return `Itinerary loaded: ${successfulFlights} flights. Layovers are calculated between matching airports.`;
  }
  return `Loaded ${successfulFlights} of ${entries.length} flights. Failed lookups are shown below.`;
}

addFlightButton.addEventListener("click", () => {
  if (flightNumberList.children.length >= maxFlightLegs) return;
  flightNumberList.append(flightInputTemplate.content.cloneNode(true));
  updateFlightInputRows();
  flightNumberList.querySelector(".flight-number-row:last-child input").focus();
});

flightNumberList.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".remove-flight");
  if (!removeButton || flightNumberList.children.length <= 1) return;
  removeButton.closest(".flight-number-row").remove();
  updateFlightInputRows();
});

liveFlightForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const inputs = [...flightNumberList.querySelectorAll(".flight-number-input")];
  const flightIatas = inputs.map((input) => input.value.trim().toUpperCase().replace(/[\s-]/g, ""));
  const invalidIndex = flightIatas.findIndex((flightIata) => !validFlightNumber(flightIata));
  if (invalidIndex !== -1) {
    lookupMessage.textContent = `Enter a valid flight number for leg ${invalidIndex + 1}, such as AA100.`;
    inputs[invalidIndex].focus();
    return;
  }

  activeFlights = [];
  liveResult.hidden = true;
  flightVisual.hidden = true;
  setLookupBusy(true);
  const entries = [];

  try {
    for (const [index, flightIata] of flightIatas.entries()) {
      lookupMessage.textContent = `Checking flight ${index + 1} of ${flightIatas.length}: ${flightIata}…`;
      try {
        const payload = await fetchFlightStatus(flightIata);
        entries.push({
          flightIata,
          flight: payload.flight,
          source: payload.source,
          cacheStored: payload.cacheStored,
        });
      } catch (error) {
        entries.push({ flightIata, error });
      }
    }

    activeFlights = entries;
    const successfulFlights = renderItinerary(entries);
    lookupMessage.textContent = lookupStatusMessage(entries, successfulFlights);
  } finally {
    setLookupBusy(false);
  }
});

flightVisualList.addEventListener("click", async (event) => {
  const refreshButton = event.target.closest(".flight-refresh");
  if (!refreshButton) return;
  const flightIndex = Number(refreshButton.dataset.flightIndex);
  const entry = activeFlights[flightIndex];
  if (!entry?.flight) return;

  setLookupBusy(true);
  lookupMessage.textContent = `Refreshing position for flight ${entry.flight.flightNumber}…`;
  try {
    const payload = await fetchFlightStatus(entry.flightIata, true);
    activeFlights[flightIndex] = {
      ...entry,
      flight: payload.flight,
      source: payload.source,
      cacheStored: payload.cacheStored,
    };
    const successfulFlights = renderItinerary(activeFlights);
    lookupMessage.textContent = `Position refreshed for ${payload.flight.flightNumber} from ${payload.source}.`;
  } catch (error) {
    lookupMessage.textContent = `Position refresh failed: ${errorMessage(error)}`;
  } finally {
    setLookupBusy(false);
  }
});

const timeElement = document.querySelector("#current-time");
const updateLocalTime = () => {
  timeElement.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
  document.querySelectorAll(".arrival-countdown[data-target-time]").forEach((countdown) => {
    countdown.textContent = formatTimeToArrival(new Date(Number(countdown.dataset.targetTime)));
  });
};

updateFlightInputRows();
updateLocalTime();
setInterval(updateLocalTime, 60_000);
