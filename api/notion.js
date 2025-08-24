import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

/* ---------- small helpers (tolerant to missing props) ---------- */
const readCheckbox = (p) => (p && typeof p.checkbox !== "undefined" ? p.checkbox === true : false);
const readSelect = (p) => (p && p.select && p.select.name ? p.select.name : "");
const readTitle = (p) => (p?.title?.[0]?.plain_text ?? "Untitled");
const readDate = (p) => (p?.date?.start ?? null);
const readURLorText = (p) => (p?.url ?? (p?.rich_text?.[0]?.plain_text ?? ""));
const readFiles = (p) =>
  (p?.files ?? [])
    .map((f) => f.external?.url || f.file?.url)
    .filter(Boolean);

/* ---------- map one page to a widget item ---------- */
function mapPage(page) {
  const props = page.properties;

  const source = readSelect(props["Image Source"]);
  let media = [];

  if (source === "Image Attachment") {
    media = readFiles(props["Attachment"]);
  } else if (source === "Link") {
    const u = readURLorText(props["Link"]);
    if (u) media = [u];
  } else if (source === "Canva Design") {
    let u = readURLorText(props["Canva Link"]);
    // normalize canva share links a bit
    if (u && /canva\.com/.test(u) && !/\/view$/.test(u)) {
      try {
        const url = new URL(u);
        if (!url.pathname.endsWith("/view")) {
          url.pathname = url.pathname.replace(/\/edit$/, "") + "/view";
          u = url.toString();
        }
      } catch (_) {}
    }
    if (u) media = [u];
  }

  return {
    id: page.id,
    name: readTitle(props["Name"]),
    date: readDate(props["Publish Date"]), // ISO or null
    platform: readSelect(props["Platform"]) || "All",
    pinned: readCheckbox(props["Pinned"]),
    hide: readCheckbox(props["Hide"]),
    media, // array of urls (images/videos/Canva)
  };
}

/* ---------- the handler ---------- */
export default async function handler(req, res) {
  try {
    const platformFilter = (req.query.platform || "").trim();

    // Build a tolerant filter: skip "Hide", require NOT Hide, and only rows
    // that have some media possibility indicated (source selected).
    // We’ll still validate media later.
    const andFilter = [
      {
        or: [
          { property: "Hide", checkbox: { equals: false } },
          { property: "Hide", checkbox: { does_not_equal: true } }, // works when box is blank
        ],
      },
    ];

    // Optional platform filter if provided and not "All"
    if (platformFilter && platformFilter.toLowerCase() !== "all") {
      andFilter.push({
        property: "Platform",
        select: { equals: platformFilter },
      });
    }

    const query = await notion.databases.query({
      database_id: databaseId,
      filter: { and: andFilter },
      // We’ll do final ordering ourselves (pinned, then date desc),
      // but an initial sort by date can help.
      sorts: [{ property: "Publish Date", direction: "descending" }],
    });

    // Shape + final filter (must have at least one media URL)
    let items = query.results.map(mapPage).filter((it) => it.media.length > 0);

    // Sort: pinned first, then by publish date DESC (newest first)
    items.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const ad = a.date ? Date.parse(a.date) : 0;
      const bd = b.date ? Date.parse(b.date) : 0;
      return bd - ad;
    });

    res.status(200).json({ items });
  } catch (err) {
    console.error("API Error:", err);
    res.status(500).json({ error: "Server error", detail: String(err?.message || err) });
  }
}
