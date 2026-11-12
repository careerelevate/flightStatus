const flights = [
  { airline: "Northstar Air", mark: "NA", flight: "NS 204", from: "New York", fromCode: "JFK", to: "London", toCode: "LHR", departure: "8:15 PM", arrival: "8:20 AM", status: "On time" },
  { airline: "Pacific Air", mark: "PA", flight: "PA 718", from: "San Francisco", fromCode: "SFO", to: "Tokyo", toCode: "HND", departure: "9:40 PM", arrival: "1:05 AM", arrivalDay: "+1 day", status: "Delayed" },
  { airline: "Skyward", mark: "SW", flight: "SW 132", from: "Chicago", fromCode: "ORD", to: "Denver", toCode: "DEN", departure: "6:25 PM", arrival: "8:02 PM", status: "Boarding" },
  { airline: "Northstar Air", mark: "NA", flight: "NS 506", from: "Boston", fromCode: "BOS", to: "Miami", toCode: "MIA", departure: "7:10 PM", arrival: "10:36 PM", status: "On time" },
  { airline: "Coastal", mark: "CO", flight: "CO 441", from: "Seattle", fromCode: "SEA", to: "Los Angeles", toCode: "LAX", departure: "3:30 PM", arrival: "6:04 PM", status: "Landed" },
  { airline: "Skyward", mark: "SW", flight: "SW 890", from: "Dallas", fromCode: "DFW", to: "Atlanta", toCode: "ATL", departure: "8:55 PM", arrival: "12:12 AM", arrivalDay: "+1 day", status: "On time" },
];

const flightList = document.querySelector("#flight-list");
const searchInput = document.querySelector("#flight-search");
const emptyState = document.querySelector("#empty-state");
const filterButtons = document.querySelectorAll(".filter-button");
let activeFilter = "all";

function renderFlights() {
  const search = searchInput.value.trim().toLowerCase();
  const matches = flights.filter((flight) => {
    const matchesSearch = [
      flight.airline,
      flight.flight,
      flight.from,
      flight.fromCode,
      flight.to,
      flight.toCode,
      flight.status,
    ].some((value) => value.toLowerCase().includes(search));
    const matchesFilter = activeFilter === "all" || flight.status === activeFilter;
    return matchesSearch && matchesFilter;
  });

  flightList.innerHTML = matches.map((flight) => {
    const statusClass = flight.status.toLowerCase().replaceAll(" ", "-");
    const dayLabel = flight.arrivalDay ? `<span class="time-change">${flight.arrivalDay}</span>` : "";
    return `
      <article class="flight-row">
        <div class="airline">
          <span class="airline-mark" aria-hidden="true">${flight.mark}</span>
          <div>
            <span class="airline-name">${flight.airline}</span>
            <span class="flight-number">${flight.flight}</span>
          </div>
        </div>
        <div class="route" aria-label="${flight.from}, ${flight.fromCode} to ${flight.to}, ${flight.toCode}">
          <div>
            <span class="city">${flight.from}</span>
            <span class="airport-code">${flight.fromCode}</span>
          </div>
          <span class="route-line" aria-hidden="true"><span class="route-plane">✈</span></span>
          <div>
            <span class="city">${flight.to}</span>
            <span class="airport-code">${flight.toCode}</span>
          </div>
        </div>
        <div class="arrival">
          <span class="time-value">${flight.departure}<span class="time-change">→</span>${flight.arrival} ${dayLabel}</span>
          <span class="time-label">Departure → Arrival</span>
        </div>
        <span class="status status--${statusClass}">${flight.status}</span>
      </article>`;
  }).join("");

  emptyState.hidden = matches.length > 0;
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach((filterButton) => {
      const isActive = filterButton === button;
      filterButton.classList.toggle("is-active", isActive);
      filterButton.setAttribute("aria-pressed", String(isActive));
    });
    renderFlights();
  });
});

searchInput.addEventListener("input", renderFlights);

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.focus();
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

renderFlights();
updateLocalTime();
setInterval(updateLocalTime, 60_000);
