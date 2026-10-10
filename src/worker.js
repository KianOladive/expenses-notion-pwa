// Proxies one Notion database to the PWA. The Notion token never leaves the server.
const NOTION_VERSION = "2022-06-28";
const DATE_PROP = "Date";
const MAX_ROWS = 300; // newest entries only, so a refresh stays around 1–2 s

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/rows") return rows(req, env);
    return env.ASSETS.fetch(req);
  },
};

async function rows(req, env) {
  if (req.headers.get("x-app-key") !== env.APP_KEY) {
    return json({ error: "Wrong access key" }, 401);
  }
  if (env.NOTION_TOKEN === "demo") return json(demoData());

  try {
    const [db, pages] = await Promise.all([
      notion(env, `databases/${env.DATABASE_ID}`),
      queryAll(env),
    ]);
    const columns = Object.entries(db.properties)
      .map(([name, p]) => ({ name, type: p.type }))
      .sort((a, b) => (a.type === "title" ? -1 : b.type === "title" ? 1 : 0));
    const names = await relationNames(env, pages);
    return json({
      title: plain(db.title) || "Notion",
      fetchedAt: new Date().toISOString(),
      columns,
      rows: pages.map((page) => ({
        id: page.id,
        url: page.url,
        edited: page.last_edited_time,
        props: Object.fromEntries(
          Object.entries(page.properties).map(([name, p]) => [
            name,
            p.type === "relation" ? p.relation.map((r) => names.get(r.id) ?? "?").join(", ") || null : simplify(p),
          ])
        ),
      })),
    });
  } catch (err) {
    return json({ error: err.message }, 502);
  }
}

// Linked pages (e.g. categories) rarely change, so keep their titles for the life of the worker.
const titleCache = new Map();

async function relationNames(env, pages) {
  const ids = new Set();
  for (const page of pages) {
    for (const p of Object.values(page.properties)) {
      if (p.type === "relation") p.relation.forEach((r) => ids.add(r.id));
    }
  }
  const missing = [...ids].filter((id) => !titleCache.has(id)).slice(0, 40);
  await Promise.all(
    missing.map(async (id) => {
      try {
        const page = await notion(env, `pages/${id}`);
        const title = Object.values(page.properties).find((p) => p.type === "title");
        titleCache.set(id, plain(title?.title) || "Untitled");
      } catch {
        titleCache.set(id, "?"); // linked page not shared with the integration
      }
    })
  );
  return titleCache;
}

async function queryAll(env) {
  const out = [];
  let cursor;
  do {
    const res = await notion(env, `databases/${env.DATABASE_ID}/query`, {
      page_size: 100,
      start_cursor: cursor,
      sorts: [{ property: DATE_PROP, direction: "descending" }],
    });
    out.push(...res.results);
    cursor = res.has_more && out.length < MAX_ROWS ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function notion(env, path, body) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Notion ${res.status}: ${data.message}`);
  return data;
}

const plain = (rich) => (rich || []).map((t) => t.plain_text).join("");

// Turn a Notion property into a string, number, boolean or list of strings.
function simplify(p) {
  const v = p[p.type];
  switch (p.type) {
    case "title":
    case "rich_text":
      return plain(v);
    case "select":
    case "status":
      return v?.name ?? null;
    case "multi_select":
      return v.map((o) => o.name);
    case "people":
      return v.map((u) => u.name || "Someone");
    case "files":
      return v.map((f) => f.name);
    case "date":
      return v ? [v.start, v.end].filter(Boolean).join(" → ") : null;
    case "formula":
      return v[v.type] ?? null;
    case "rollup":
      if (v.type === "array") return `${v.array.length} items`;
      return v.type === "date" ? v.date?.start ?? null : v[v.type];
    case "unique_id":
      return [v.prefix, v.number].filter((x) => x != null).join("-");
    case "created_by":
    case "last_edited_by":
      return v?.name ?? null;
    default:
      return v ?? null; // number, checkbox, url, email, phone_number, timestamps
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function demoData() {
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const entries = [
    ["Coffee", 120, day(0), "Food & Drinks"],
    ["Bus fare", 45, day(0), "Transport"],
    ["Sandwich", 180, day(1), "Food & Drinks"],
    ["Movie ticket", 350, day(1), "Entertainment"],
    ["Weekly groceries", 1850, day(3), "Groceries"],
    ["Phone plan", 999, day(5), "Bills"],
  ];
  return {
    title: "Demo Expenses",
    fetchedAt: new Date().toISOString(),
    columns: [
      { name: "Name", type: "title" },
      { name: "Amount", type: "number" },
      { name: "Date", type: "date" },
      { name: "Category", type: "select" },
      { name: "Notes", type: "rich_text" },
    ],
    rows: entries.map(([Name, Amount, date, Category], i) => ({
      id: `demo-${i}`,
      url: "https://www.notion.so",
      edited: new Date().toISOString(),
      props: { Name, Amount, Date: date, Category, Notes: "" },
    })),
  };
}
