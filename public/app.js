// Shows the last cached data immediately, then refreshes from /api/rows.
// Column names in the Notion database.
const COL = { name: "Name", amount: "Amount", date: "Date", category: "Category", notes: "Notes" };
const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let data = store.get("data");
let key = store.get("key");

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

$("search").addEventListener("input", render);
$("refresh").addEventListener("click", refresh);
$("key-form").addEventListener("submit", (e) => {
  e.preventDefault();
  key = $("key-input").value.trim();
  store.set("key", key);
  $("key-form").hidden = true;
  refresh();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && key) refresh();
});

render();
if (key) refresh();
else $("key-form").hidden = false;

async function refresh() {
  $("refresh").classList.add("spin");
  try {
    const res = await fetch("api/rows", { headers: { "x-app-key": key } });
    const body = await res.json();
    if (res.status === 401) {
      $("key-form").hidden = false;
      throw new Error(body.error);
    }
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    data = body;
    store.set("data", data);
    render();
  } catch (err) {
    setStatus(`Couldn't refresh: ${err.message}`, true);
  } finally {
    $("refresh").classList.remove("spin");
  }
}

function render() {
  const list = $("list");
  const openIds = new Set([...list.querySelectorAll("details[open]")].map((d) => d.dataset.id));
  list.replaceChildren();
  if (!data) {
    list.append(el("p", "empty", "Loading…"));
    return;
  }
  $("title").textContent = data.title;
  document.title = data.title;

  const nameCol = data.columns.find((c) => c.type === "title")?.name || COL.name;
  const entries = data.rows.map((r) => ({
    id: r.id,
    url: r.url,
    name: r.props[nameCol] || "Untitled",
    amount: Number(r.props[COL.amount]) || 0,
    day: (r.props[COL.date] || "").slice(0, 10),
    category: r.props[COL.category],
    notes: r.props[COL.notes],
  }));

  const q = $("search").value.trim().toLowerCase();
  const shown = entries.filter((e) => !q || `${e.name} ${e.category} ${e.notes}`.toLowerCase().includes(q));

  const month = todayKey().slice(0, 7);
  const monthTotal = sum(entries.filter((e) => e.day.startsWith(month)));
  $("summary").replaceChildren(
    el("span", null, q ? "Matching" : `${monthName(month)} so far`),
    el("strong", null, peso.format(q ? sum(shown) : monthTotal))
  );
  setStatus(`Updated ${ago(data.fetchedAt)}`);

  if (!shown.length) list.append(el("p", "empty", q ? "Nothing matches." : "No entries yet."));

  const groups = new Map();
  for (const e of shown) {
    if (!groups.has(e.day)) groups.set(e.day, []);
    groups.get(e.day).push(e);
  }
  for (const [day, items] of groups) {
    const section = el("section", "day");
    const head = el("div", "day-head");
    head.append(el("span", null, dayLabel(day)), el("span", null, peso.format(sum(items))));
    section.append(head);

    for (const e of items) {
      const item = el("details", "entry");
      item.dataset.id = e.id;
      item.open = openIds.has(e.id);
      const summary = el("summary");
      const left = el("div");
      left.append(el("div", "name", e.name));
      if (e.category) left.append(el("div", "category", e.category));
      summary.append(left, el("div", "amount", peso.format(e.amount)));
      item.append(summary);

      const more = el("div", "more");
      if (e.notes) more.append(el("p", null, e.notes));
      const open = el("a", null, "Open in Notion ↗");
      open.href = e.url;
      more.append(open);
      item.append(more);
      section.append(item);
    }
    list.append(section);
  }
}

function sum(items) {
  return items.reduce((t, e) => t + e.amount, 0);
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(day) {
  if (!day) return "No date";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const opts = { weekday: "short", month: "short", day: "numeric" };
  if (y !== new Date().getFullYear()) opts.year = "numeric";
  return date.toLocaleDateString(undefined, opts);
}

function monthName(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long" });
}

function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} h ago` : `${Math.round(hrs / 24)} d ago`;
}

function setStatus(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
