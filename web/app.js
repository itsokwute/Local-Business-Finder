"use strict";
const $ = (selector) => document.querySelector(selector);
const key = "nova-website-prospects-v1";
const dialog = $("#dialog");
const form = $("#lead");
let editing;
let prospects = [];
try { prospects = JSON.parse(localStorage.getItem(key) || "[]"); } catch { /* Start with an empty list if browser storage is unavailable. */ }

function google(query, maps = false) {
  const url = new URL(maps ? "https://www.google.com/maps/search/" : "https://www.google.com/search");
  url.searchParams.set(maps ? "query" : "q", query);
  if (maps) url.searchParams.set("api", "1");
  return url.href;
}
function node(tag, value, className) {
  const el = document.createElement(tag);
  el.textContent = value;
  if (className) el.className = className;
  return el;
}
function link(label, url) {
  const el = node("a", label);
  el.href = url;
  el.target = "_blank";
  el.rel = "noopener noreferrer";
  return el;
}
function website(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}
const searchForm = $("#search");
const searchStatus = $("#search-status");
const searchButton = $("#run-search");
const resultPanel = $("#lead-results");
const resultList = $("#result-list");
const moreButton = $("#search-more");
const moreStatus = $("#more-status");
let activeSearch;
let resultsFilter = "all";

const apiKeyField = searchForm.elements.apiKey;
const keyStorageName = "nova-outscraper-api-key";
const forgetKey = $("#forget-key");
const keyStatus = $("#key-status");

function showSavedKey(saved) {
  forgetKey.hidden = !saved;
  keyStatus.textContent = saved ? "API key saved in this browser." : "";
}

try {
  apiKeyField.value = localStorage.getItem(keyStorageName) || "";
  showSavedKey(Boolean(apiKeyField.value));
} catch { /* Search still works if browser storage is disabled. */ }

forgetKey.addEventListener("click", () => {
  try {
    localStorage.removeItem(keyStorageName);
    apiKeyField.value = "";
    showSavedKey(false);
    apiKeyField.focus();
  } catch {
    keyStatus.textContent = "This browser could not remove the saved key.";
  }
});

function requestLeads(input) {
  return fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

const resultSaveButtons = new Map();

function prospectIdentity(prospect) {
  return [prospect.name, prospect.city, prospect.address]
    .map((part) => String(part ?? "").trim().toLowerCase()).join("|");
}

function isSaved(prospect) {
  return prospects.some((item) => (prospect.listingId && item.listingId === prospect.listingId) ||
    prospectIdentity(item) === prospectIdentity(prospect));
}

function updateSaveButtons() {
  for (const [button, prospect] of resultSaveButtons) {
    const saved = isSaved(prospect);
    button.disabled = saved;
    button.textContent = saved ? "Saved" : "Save";
    button.setAttribute("aria-label", (saved ? "Saved " : "Save ") + prospect.name);
  }
}

function saveResult(prospect) {
  if (isSaved(prospect)) return;
  const status = $("#save-status");
  if (!persistProspects([...prospects, { ...prospect, id: crypto.randomUUID() }])) {
    status.textContent = "This browser could not save the prospect.";
    return;
  }
  render();
  status.textContent = prospect.name + " was added to Saved Prospects.";
}

function listingCards(listings, zip) {
  const list = node("ul", "", "result-list");
  for (const listing of listings) {
    const item = node("li", "", "card");
    const websiteStatus = listing.hasWebsite ? "Website Link Listed" : "No Website Link Returned";
    item.append(
      node("h3", listing.name),
      node("p", listing.address || "Street address not listed"),
      node("p", listing.rating.toFixed(1) + " ★" + (listing.reviews ? " · " + listing.reviews + " reviews" : "")),
      node("span", websiteStatus, "chip"),
      node("p", "Business phone: " + (listing.phone || "Not listed")),
      node("p", "Public email: " + (listing.email || "Not listed"))
    );
    const websiteUrl = website(listing.website);
    if (websiteUrl) item.append(link(websiteUrl, websiteUrl));
    const location = listing.address || zip + ", USA";
    const actions = node("div", "", "links");
    actions.append(
      link("View Google Listing ↗", google(listing.name + " " + location, true)),
      link("Look Up Public Contact Details ↗", google('"' + listing.name + '" ' + location + " contact email"))
    );
    const prospect = {
      listingId: listing.id, name: listing.name, city: listing.city || "ZIP " + zip,
      address: listing.address, category: listing.category, rating: String(listing.rating),
      reviews: String(listing.reviews ?? ""), phone: listing.phone, email: listing.email,
      website: websiteUrl, status: websiteUrl ? "Website found" : "Needs verification",
      stage: "Researching", notes: ""
    };
    const saveButton = node("button", "Save");
    saveButton.type = "button";
    resultSaveButtons.set(saveButton, prospect);
    saveButton.addEventListener("click", () => saveResult(prospect));
    actions.append(saveButton);
    item.append(actions);
    list.append(item);
  }
  return list;
}

function showResults() {
  const { first, zip, followUp } = activeSearch;
  resultSaveButtons.clear();
  resultList.replaceChildren();
  const listings = new Map(first.listings.map((listing) => [listing.id, listing]));
  for (const listing of followUp?.listings ?? []) {
    const previous = listings.get(listing.id);
    listings.set(listing.id, {
      ...listing,
      address: listing.address || previous?.address || "",
      hasWebsite: listing.hasWebsite || Boolean(previous?.hasWebsite),
      website: listing.website || previous?.website || "",
      phone: listing.phone || previous?.phone || "",
      email: listing.email || previous?.email || ""
    });
  }
  const hasContact = (listing) => Boolean(listing.phone || listing.email);
  const actionable = (listing) => !listing.hasWebsite && listing.address && hasContact(listing);
  const subsets = [
    ["all", "Total Businesses", () => true],
    ["with-site", "Website Link Listed", (listing) => listing.hasWebsite],
    ["no-site", "No Website Link Returned", (listing) => !listing.hasWebsite],
    ["ready", "No Link, Address and Contact", actionable],
    ["no-address", "No Link and Address Missing", (listing) => !listing.hasWebsite && !listing.address],
    ["contact", "Public Phone or Email Listed", hasContact]
  ];
  const all = [...listings.values()];
  const statCards = subsets.map(([id, label, match], index) => {
    const card = node("div", "", "result-stat");
    const button = node("button", label);
    button.type = "button";
    button.dataset.filter = id;
    button.setAttribute("aria-pressed", String(resultsFilter === id));
    button.addEventListener("click", () => {
      resultsFilter = id;
      showResults();
      $("#result-stats").children[index].querySelector("button").focus();
    });
    const term = node("dt", "");
    term.append(button);
    card.append(term, node("dd", all.filter(match).length.toLocaleString()));
    return card;
  });
  $("#result-stats").replaceChildren(...statCards);
  $("#result-summary").textContent = "Unique businesses rated 4.0 or higher in ZIP " + zip +
    " · Google Maps data via Outscraper";
  const visible = all.filter(subsets.find(([id]) => id === resultsFilter)[2]);
  const reviews = (a, b) => (b.reviews ?? 0) - (a.reviews ?? 0);
  const rating = (a, b) => b.rating - a.rating;
  const sort = $("#result-sort").value;
  visible.sort((a, b) => {
    if (sort === "reviews") return reviews(a, b) || rating(a, b);
    if (sort === "rating") return rating(a, b) || reviews(a, b);
    return Number(Boolean(actionable(b))) - Number(Boolean(actionable(a))) ||
      Number(!b.hasWebsite) - Number(!a.hasWebsite) || reviews(a, b) || rating(a, b);
  });
  $("#visible-count").textContent = "Showing " + visible.length + " of " + all.length + " businesses";
  resultList.append(visible.length ? listingCards(visible, zip) :
    node("p", "No businesses match this view. Clear the filter or search more categories.", "empty"));
  updateSaveButtons();
  resultPanel.hidden = false;
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (searchButton.disabled) return;
  const zip = searchForm.elements.zip.value.trim();
  if (!/^\d{5}$/.test(zip)) {
    searchStatus.textContent = "Enter a five-digit U.S. ZIP code.";
    return;
  }
  activeSearch = undefined;
  resultsFilter = "all";
  resultPanel.hidden = true;
  resultList.replaceChildren();
  resultSaveButtons.clear();
  $("#save-status").textContent = "";
  searchButton.disabled = true;
  apiKeyField.disabled = true;
  forgetKey.disabled = true;
  searchStatus.textContent = "Searching Google listings in " + zip + "…";
  try {
    const input = { zip, category: searchForm.elements.category.value, apiKey: apiKeyField.value.trim() };
    const response = await requestLeads(input);
    const data = await response.json();
    if (!response.ok) {
      searchStatus.textContent = data.error;
      if (data.needsKey) {
        $("#provider").open = true;
        apiKeyField.disabled = false;
        apiKeyField.focus();
      }
      return;
    }
    searchStatus.textContent = "";
    if (input.apiKey && data.usedSubmittedKey) {
      try {
        localStorage.setItem(keyStorageName, input.apiKey);
        showSavedKey(true);
      } catch {
        keyStatus.textContent = "Browser storage is unavailable. Keep this page open to reuse the key.";
      }
    }
    activeSearch = { first: data, zip, category: input.category };
    moreButton.disabled = false;
    moreStatus.textContent = "A follow-up search may use additional Outscraper quota.";
    showResults();
    $("#results-title").focus();
    searchStatus.textContent = "";
  } catch {
    searchStatus.textContent = "The search could not be completed. Check your connection and try again.";
  } finally {
    searchButton.disabled = false;
    apiKeyField.disabled = false;
    forgetKey.disabled = false;
  }
});
$("#result-sort").addEventListener("change", showResults);
$("#clear-results-filter").addEventListener("click", () => {
  resultsFilter = "all";
  showResults();
});
moreButton.addEventListener("click", async () => {
  const current = activeSearch;
  moreButton.disabled = true;
  moreStatus.textContent = "Searching additional listings…";
  try {
    const response = await requestLeads({ zip: current.zip, category: current.category, apiKey: apiKeyField.value.trim(), targeted: true });
    const data = await response.json();
    if (activeSearch !== current) return;
    if (!response.ok) throw new Error(data.error);
    current.followUp = data;
    showResults();
    moreStatus.textContent = "Follow-up search complete. Results are combined above.";
  } catch (error) {
    if (activeSearch !== current) return;
    moreButton.disabled = false;
    moreStatus.textContent = error.message || "Follow-up search failed. The initial results are still available.";
  }
});

const stages = ["Researching", "Ready to contact", "Contacted", "Replied", "Closed"];
const websiteStatuses = ["Needs verification", "No website found", "Website found", "Working", "Broken or redirected", "Social page only"];
const outreachEligible = (status) => ["No website found", "Broken or redirected", "Social page only"].includes(status);

function prospectSelect(prospect, field, label, options) {
  const control = node("label", label);
  const select = node("select", "");
  select.setAttribute("aria-label", label + " for " + prospect.name);
  for (const option of options) {
    const item = node("option", option);
    item.value = option;
    select.append(item);
  }
  select.value = prospect[field];
  select.addEventListener("change", () => {
    const next = { ...prospect, [field]: select.value };
    if (field === "status" && next.stage === "Ready to contact" && !outreachEligible(next.status)) next.stage = "Researching";
    if (next.stage === "Ready to contact" && !outreachEligible(next.status)) {
      select.value = prospect[field];
      select.setCustomValidity("Verify a missing, broken, or social-only website before marking ready to contact.");
      select.reportValidity();
      select.setCustomValidity("");
      return;
    }
    if (!persistProspects(prospects.map((item) => item.id === next.id ? next : item))) {
      select.value = prospect[field];
      select.setCustomValidity("This browser could not save your changes.");
      select.reportValidity();
      select.setCustomValidity("");
      return;
    }
    render();
  });
  control.append(select);
  return control;
}

function csvCell(value) {
  let cell = String(value ?? "");
  if (/^[\s]*[=+@-]|^[\t\r\n]/.test(cell)) cell = "'" + cell;
  return '"' + cell.replaceAll('"', '""') + '"';
}

$("#export").addEventListener("click", () => {
  const columns = [["Business Name", "name"], ["Category", "category"], ["Street Address", "address"],
    ["City and State", "city"], ["Business Phone", "phone"], ["Public Email", "email"], ["Website URL", "website"],
    ["Website Status", "status"], ["Outreach Stage", "stage"], ["Google Rating", "rating"], ["Review Count", "reviews"], ["Research Notes", "notes"]];
  const rows = [columns.map(([label]) => label), ...prospects.map((p) => columns.map(([, key]) => p[key]))];
  const url = URL.createObjectURL(new Blob(["\ufeff", rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const download = document.createElement("a");
  download.href = url;
  download.download = "saved-prospects.csv";
  download.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function render() {
  $("#export").disabled = prospects.length === 0;
  updateSaveButtons();
  const query = $("#query").value.trim().toLowerCase();
  const filter = $("#filter").value;
  const matches = prospects.filter((p) =>
    (!filter || p.status === filter) && [p.name, p.city, p.category].join(" ").toLowerCase().includes(query)
  ).sort((a, b) => Number(b.reviews) - Number(a.reviews) || Number(b.rating) - Number(a.rating));
  const results = $("#results");
  results.replaceChildren();
  if (!matches.length) {
    results.append(node("div", prospects.length ? "No prospects match these filters." : "No prospects yet. Add the first business you want to track.", "empty"));
    return;
  }
  results.append(node("p", matches.length + (matches.length === 1 ? " prospect" : " prospects"), "meta"));
  const cards = node("div", "", "cards");
  for (const p of matches) {
    const card = node("article", "", "card");
    const details = [p.category, p.address, p.city].filter(Boolean).join(" · ");
    const rating = Number(p.rating).toFixed(1) + " ★" + (p.reviews ? " · " + Number(p.reviews).toLocaleString() + " reviews" : "");
    card.append(node("h3", p.name), node("p", details, "meta"), node("p", rating), node("span", p.status + " · " + p.stage, "chip"));
    if (p.phone || p.email) card.append(node("p", [p.phone, p.email].filter(Boolean).join(" · "), "meta"));
    if (p.notes) card.append(node("p", p.notes, "meta"));
    const actions = node("div", "", "links");
    const edit = node("button", "Edit", "secondary");
    edit.addEventListener("click", () => openForm(p));
    actions.append(link("Google Maps ↗", google([p.name, p.address, p.city].filter(Boolean).join(" "), true)), link("Check for a website ↗", google('"' + p.name + '" ' + p.city)), edit);
    if (website(p.website)) card.append(link(website(p.website), website(p.website)));
    const controls = node("div", "", "fields");
    controls.append(prospectSelect(p, "status", "Website Status", websiteStatuses),
      prospectSelect(p, "stage", "Outreach Stage", stages));
    card.append(controls, actions);
    cards.append(card);
  }
  results.append(cards);
}
function openForm(p) {
  editing = p?.id;
  form.reset();
  $("#form-error").textContent = "";
  $("#dialog-title").textContent = p ? "Edit Prospect" : "Add Prospect";
  $("#remove").hidden = !p;
  if (p) for (const input of form.elements) if (input.name) input.value = p[input.name] ?? "";
  if (!p) for (const name of ["category"]) form.elements[name].value = $("#search").elements[name].value.trim();
  dialog.showModal();
}
function persistProspects(next) {
  try { localStorage.setItem(key, JSON.stringify(next)); }
  catch { return false; }
  prospects = next;
  return true;
}

function save(next) {
  if (!persistProspects(next)) {
    $("#form-error").textContent = "This browser could not save your changes.";
    return;
  }
  dialog.close();
  render();
}
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const p = Object.fromEntries(Array.from(new FormData(form), ([name, value]) => [name, value.trim()]));
  const error = $("#form-error");
  if (!p.name || !p.city) { error.textContent = "Enter a business name and city."; return; }
  if (p.website && !website(p.website)) { error.textContent = "Enter an HTTP or HTTPS website address."; return; }
  if (p.website && p.status === "Needs verification") p.status = "Website found";
  if (p.stage === "Ready to contact" && !outreachEligible(p.status)) { error.textContent = "Verify a missing, broken, or social-only website before marking ready to contact."; return; }
  if (prospects.some((item) => item.id !== editing && prospectIdentity(item) === prospectIdentity(p))) {
    error.textContent = "This business is already in your prospects.";
    return;
  }
  p.id = editing ?? crypto.randomUUID();
  save(editing ? prospects.map((item) => item.id === editing ? { ...item, ...p } : item) : [...prospects, p]);
});
$("#remove").addEventListener("click", () => {
  if (window.confirm("Delete this prospect?")) save(prospects.filter((p) => p.id !== editing));
});
$("#add").addEventListener("click", () => openForm());
$("#close").addEventListener("click", () => dialog.close());
$("#query").addEventListener("input", render);
$("#filter").addEventListener("change", render);
render();
