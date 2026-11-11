const noCache = { "Cache-Control": "no-store" };

function json(value, status = 200) {
  return Response.json(value, { status, headers: noCache });
}

function publicEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : "";
}

function listingWebsite(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const candidate = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#:]|$)/i.test(text) ?
    "https://" + text : text;
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function matchingLeads(rows, zip) {
  const leads = new Map();
  const counts = { returned: 0, inZip: 0, rated: 0 };
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    counts.returned++;
    const fullAddress = String(row.full_address || "").trim();
    const street = String(row.street || "").trim();
    const address = fullAddress || (street ? [street, row.city, [row.us_state || row.state, row.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "");
    const postal = String(row.postal_code ?? "").trim();
    const addressZip = address.match(/\b[A-Z]{2}\s+(\d{5})(?:-\d{4})?(?:,?\s+(?:USA|United States))?$/i)?.[1];
    if ((row.country_code && String(row.country_code).toUpperCase() !== "US") ||
        (postal ? postal.split("-")[0] : addressZip) !== zip) continue;
    counts.inZip++;
    const rating = Number(row.rating);
    if (!Number.isFinite(rating) || rating < 4 || rating > 5) continue;
    counts.rated++;
    const name = String(row.name || "").trim();
    if (!name) continue;
    const identity = row.place_id || [name, address].join("|").toLowerCase();
    const hasWebsite = [row.site, row.website].some((value) => String(value ?? "").trim());
    const previous = leads.get(identity);
    leads.set(identity, {
      id: identity,
      name,
      address: address || previous?.address || "",
      hasWebsite: hasWebsite || Boolean(previous?.hasWebsite),
      website: listingWebsite(row.site) || listingWebsite(row.website) || previous?.website || "",
      city: [row.city, row.state].filter(Boolean).join(", "),
      category: row.category || "",
      rating,
      reviews: row.reviews || null,
      phone: row.phone || previous?.phone || "",
      email: publicEmail(row.email) || publicEmail(row.email_1) || previous?.email || ""
    });
  }
  return { counts, listings: [...leads.values()].sort((a, b) => b.rating - a.rating || (b.reviews ?? 0) - (a.reviews ?? 0)) };
}

async function search(request, env) {
  if (request.method !== "POST") return json({ error: "Use the dashboard to search." }, 405);
  if (request.headers.get("Origin") !== new URL(request.url).origin ||
      request.headers.get("Content-Type")?.split(";")[0] !== "application/json") {
    return json({ error: "Use the dashboard to search." }, 403);
  }
  let input;
  try { input = await request.json(); }
  catch { return json({ error: "Invalid search request." }, 400); }

  const zip = String(input?.zip ?? "");
  const category = typeof input?.category === "string" ? input.category.trim() : "";
  const submittedKey = typeof input?.apiKey === "string" ? input.apiKey.trim() : "";
  const key = submittedKey || env?.OUTSCRAPER_API_KEY;
  if (!/^\d{5}$/.test(zip) || category.length > 80) return json({ error: "Enter a five-digit U.S. ZIP code and a category of up to 80 characters." }, 400);
  if (!key) return json({ error: "Add your Outscraper API key to run a live search.", needsKey: true }, 503);
  if (key.length > 250 || /[^!-~]/.test(key)) return json({ error: "Enter a valid Outscraper API key.", needsKey: true }, 400);

  const url = new URL("https://api.outscraper.cloud/google-maps-search");
  const targeted = input?.targeted === true;
  const categories = category ? (targeted ? [category, "local businesses"] : [category]) : targeted ?
    ["barber shops", "nail salons", "auto repair", "landscaping", "cleaning services", "pet grooming"] :
    ["local businesses", "restaurants", "beauty salons", "auto repair", "home services", "retail stores"];
  for (const item of categories) url.searchParams.append("query", item + " in " + zip + ", USA");
  url.searchParams.set("limit", "20");
  url.searchParams.set("dropDuplicates", "true");
  url.searchParams.set("language", "en");
  url.searchParams.set("async", "false");
  url.searchParams.set("region", "us");
  if (targeted) {
    url.searchParams.set("totalLimit", "60");
    url.searchParams.append("filters", "only_without_website");
  }
  try {
    const response = await fetch(url, { headers: { "X-API-KEY": key }, signal: AbortSignal.timeout(55000) });
    if (response.status === 401 || response.status === 403) return json({ error: "Outscraper rejected the API key.", needsKey: true }, 401);
    if (!response.ok) return json({ error: "The provider could not complete the search. Check your Outscraper account before retrying." }, 502);
    const payload = await response.json();
    if (payload.status !== "Success" || !Array.isArray(payload.data)) {
      return json({ error: "The provider did not return completed results. Try a specific business category." }, 502);
    }
    return json({ ...matchingLeads(payload.data.flat(), zip), usedSubmittedKey: Boolean(submittedKey) });
  } catch {
    return json({ error: "The provider did not respond in time. Try a specific business category." }, 504);
  }
}

export { search };
