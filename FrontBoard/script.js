const ticketList = document.querySelector("#ticket-list");
const ticketSearch = document.querySelector("#ticket-search");
const documentUpload = document.querySelector("#document-upload");
const dropZone = document.querySelector("#drop-zone");
const loadedFiles = document.querySelector("#loaded-files");
const uploadStatus = document.querySelector("#upload-status");
const fileCount = document.querySelector("#file-count");
const clearTickets = document.querySelector("#clear-tickets");

let tickets = [];
let activeFilter = "All tickets";

function updateClock() {
  const now = new Date();
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(now);

  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(now);

  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short"
  }).formatToParts(now).find((part) => part.type === "timeZoneName")?.value || "EST";

  document.querySelector("#est-clock").textContent = time;
  document.querySelector("#est-period").textContent = zone;
  document.querySelector("#est-date").textContent = date;
}

updateClock();
setInterval(updateClock, 1000);

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelector(".nav-item.active")?.classList.remove("active");
    item.classList.add("active");
    activeFilter = item.dataset.view;
    document.querySelector("#view-title").textContent =
      activeFilter === "All tickets" ? "Upcoming tickets" : `${activeFilter} tickets`;
    renderTickets();
  });
});

ticketSearch.addEventListener("input", renderTickets);

documentUpload.addEventListener("change", () => {
  processFiles([...documentUpload.files]);
  documentUpload.value = "";
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.addEventListener("drop", (event) => {
  processFiles([...event.dataTransfer.files]);
});

clearTickets.addEventListener("click", () => {
  tickets = [];
  loadedFiles.replaceChildren();
  fileCount.textContent = "0";
  uploadStatus.textContent = "Waiting for a document";
  clearTickets.disabled = true;
  renderTickets();
});

async function processFiles(files) {
  if (!files.length) return;

  uploadStatus.textContent = `Reading ${files.length} document${files.length === 1 ? "" : "s"}...`;

  let parsedCount = 0;
  for (const file of files) {
    try {
      const text = await readDocument(file);
      const parsed = parseDocument(file.name, text);
      tickets.push(...parsed);
      parsedCount += parsed.length;
      addLoadedFile(file.name, parsed.length);
    } catch (error) {
      addLoadedFile(file.name, 0, error.message);
    }
  }

  fileCount.textContent = String(loadedFiles.children.length);
  clearTickets.disabled = tickets.length === 0;
  uploadStatus.textContent = parsedCount
    ? `${parsedCount} ticket${parsedCount === 1 ? "" : "s"} added to the board`
    : "No ticket details found. Try CSV, JSON, or TXT.";
  renderTickets();
}

async function readDocument(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (extension === "pdf") {
    if (!window.pdfjsLib) throw new Error("PDF reader could not load");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const bytes = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(" "));
    }
    return pages.join("\n");
  }
  return file.text();
}

function parseDocument(fileName, text) {
  const extension = fileName.split(".").pop().toLowerCase();

  if (extension === "json") {
    const data = JSON.parse(text);
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data.tickets)
        ? data.tickets
        : Array.isArray(data.records)
          ? data.records
          : [data];
    return rows.map(normalizeTicket).filter((ticket) => ticket.passenger || ticket.number || ticket.origin);
  }

  if (extension === "csv") {
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const headers = rows.shift().map((header) => normalizeKey(header));
    return rows.filter((row) => row.some(Boolean)).map((row) => {
      const object = {};
      headers.forEach((header, index) => { object[header] = row[index]?.trim() || ""; });
      return normalizeTicket(object);
    }).filter((ticket) => ticket.passenger || ticket.number || ticket.origin);
  }

  return parseTextFeed(text);
}

function parseTextFeed(text) {
  const blocks = text
    .split(/\n\s*\n|(?=^(?:flight|bus|ticket)\s*[:#-])/im)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 1) {
    const lines = text.split(/\n|[|;]/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 1) return [normalizeTicket(parseKeyValueLines(lines))];
  }

  return blocks.map((block) => normalizeTicket(parseKeyValueLines(block.split(/\n|[|;]/))));
}

function parseKeyValueLines(lines) {
  const result = {};
  lines.forEach((line) => {
    const match = line.match(/([^:=-]+?)\s*[:=-]\s*(.+)$/);
    if (match) result[normalizeKey(match[1])] = match[2].trim();
  });
  const text = lines.join(" ");
  if (!result.type) {
    result.type = /\bflight\b/i.test(text) ? "Flight" : /\bbus\b/i.test(text) ? "Bus" : "Ticket";
  }
  return result;
}

function normalizeTicket(input) {
  const record = Object.keys(input).reduce((output, key) => {
    output[normalizeKey(key)] = input[key];
    return output;
  }, {});

  const first = (...keys) => keys.map((key) => record[key]).find((value) => value !== undefined && value !== null && String(value).trim());
  const text = Object.values(record).join(" ");
  const type = String(first("type", "transport", "mode") || (/\bflight\b/i.test(text) ? "Flight" : /\bbus\b/i.test(text) ? "Bus" : "Ticket"));

  const normalizedType = type.trim().toLowerCase();
  return {
    type: normalizedType.includes("flight") ? "Flight" : normalizedType === "bus" ? "Bus" : type,
    number: String(first("number", "ticketnumber", "ticket_no", "ticket", "flightnumber", "flight", "busnumber", "route") || "Not provided"),
    date: String(first("date", "traveldate", "departuredate", "journeydate") || "Date not provided"),
    time: String(first("time", "departuretime", "boardtime", "departure") || "Time not provided"),
    origin: String(first("origin", "from", "departure", "source") || ""),
    destination: String(first("destination", "to", "arrival", "terminal") || ""),
    passenger: String(first("passenger", "passengername", "name", "traveler") || "Passenger not provided"),
    seat: String(first("seat", "seatnumber", "berth") || "Not assigned"),
    status: String(first("status", "bookingstatus") || "Confirmed")
  };
}

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function addLoadedFile(name, ticketCount, errorMessage) {
  const row = document.createElement("div");
  row.className = "loaded-file";
  row.innerHTML = `<span class="file-badge">DOC</span><div><strong></strong><small></small></div>`;
  row.querySelector("strong").textContent = name;
  row.querySelector("small").textContent = errorMessage || `${ticketCount} ticket${ticketCount === 1 ? "" : "s"} found`;
  if (errorMessage) row.classList.add("error");
  loadedFiles.append(row);
}

function renderTickets() {
  const search = ticketSearch.value.trim().toLowerCase();
  const visible = tickets.filter((ticket) => {
    const matchesFilter = activeFilter === "All tickets" || ticket.type === activeFilter;
    const matchesSearch = !search || Object.values(ticket).join(" ").toLowerCase().includes(search);
    return matchesFilter && matchesSearch;
  });

  const flights = tickets.filter((ticket) => ticket.type === "Flight").length;
  const buses = tickets.filter((ticket) => ticket.type === "Bus").length;
  const passengers = new Set(tickets.map((ticket) => ticket.passenger).filter((name) => name !== "Passenger not provided")).size;

  document.querySelector("#flight-count").textContent = String(flights);
  document.querySelector("#bus-count").textContent = String(buses);
  document.querySelector("#passenger-count").textContent = String(passengers);

  if (!visible.length) {
    const message = tickets.length ? "No matching tickets" : "No tickets loaded";
    const detail = tickets.length
      ? "Try a different search or ticket filter."
      : "Upload a CSV, JSON, text, or PDF document to populate this board.";
    ticketList.innerHTML = `<article class="empty-state"><span class="empty-icon">${tickets.length ? "⌕" : "⇧"}</span><h2>${message}</h2><p>${detail}</p></article>`;
    return;
  }

  ticketList.innerHTML = visible.map((ticket, index) => {
    const icon = ticket.type === "Flight" ? "✈" : ticket.type === "Bus" ? "▰" : "▦";
    const route = ticket.origin || ticket.destination
      ? `${ticket.origin || "Origin"} <span class="route-arrow">→</span> ${ticket.destination || "Destination"}`
      : "Route not provided";
    return `<article class="ticket-card">
      <div class="ticket-rail ${ticket.type.toLowerCase()}"></div>
      <div class="ticket-main">
        <div class="ticket-heading">
          <span class="ticket-type ${ticket.type.toLowerCase()}">${icon} ${escapeHtml(ticket.type)}</span>
          <span class="ticket-status">${escapeHtml(ticket.status)}</span>
        </div>
        <div class="ticket-route">${route}</div>
        <div class="ticket-number">${escapeHtml(ticket.number)}</div>
      </div>
      <div class="ticket-details">
        <div><small>Date</small><strong>${escapeHtml(ticket.date)}</strong></div>
        <div><small>Time</small><strong>${escapeHtml(ticket.time)}</strong></div>
        <div><small>Passenger</small><strong>${escapeHtml(ticket.passenger)}</strong></div>
        <div><small>Seat</small><strong>${escapeHtml(ticket.seat)}</strong></div>
      </div>
    </article>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
