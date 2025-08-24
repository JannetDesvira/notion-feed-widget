import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DATABASE_ID;

/** helpers */
const firstText = (p) =>
  p?.title?.[0]?.plain_text ??
  p?.rich_text?.[0]?.plain_text ??
  "";

const getCheckbox = (p) => (typeof p?.checkbox === "boolean" ? p.checkbox : false);

const getSelect = (p) => p?.select?.name ?? "";

const getDate = (p) => p?.date?.start ?? null;

const getURL = (p) => p?.url ?? p?.rich_text?.[0]?.plain_text ?? "";

const getFiles = (p) =>
  (p?.files ?? [])
    .map((f) => f.external?.url || f.file?.url)
    .filter(Boolean);

/** canva: normalize to viewable embed */
const normalizeCanva = (url) => {
  if (!url) return "";
  // works for share links like https://www.canva.com/design/XXXX/view
  // ensure /view and add ?embed to allow iframe
  try {
    const u = new URL(url);
    if (!/canva\.com/.test(u.hostname)) return url;
    if (!u.pathname.includes("/view")) u.pathname = u.pathname.replace(/\/edit|\/copy|\/share|\/present/g, "/view");
    u.searchParams.set("embed", "1");
    return u.toString();
  } catch {
    return url;
  }
};

export default async function handler(req, res) {
  try {
    const platform = (req.query.platform || "All").toString();

    const filters = [
      { property: "Hide", checkbox: { equals: false } },
      { property: "Publish Date", date: { is_not_empty: true } },
    ];
    if (platform && platform !== "All") {
      filters.push({ property: "Platform", select: { equals: platform } });
    }

    const q = await notion.databases.query({
      database_id: DB_ID,
      filter: { and: filters },
      sorts: [
        // pinned first, then newest first to mimic IG/TikTok feeling
        { property: "Pinned", direction: "descending" },
        { property: "Publish Date", direction: "descending" },
      ],
    });

    const items = q.results.map((page) => {
      const p = page.properties;

      const imageSource = getSelect(p["Image Source"]);
      const media = [];

      if (imageSource === "Image Attachment") {
        media.push(...getFiles(p["Attachment"]));
      } else if (imageSource === "Link") {
        const u = getURL(p["Link"]);
        if (u) media.push(u);
      } else if (imageSource === "Canva Design") {
        const u = normalizeCanva(getURL(p["Canva Link"]));
        if (u) media.push(u);
      }

      return {
        id: page.id,
        name: firstText(p["Name"]) || "Untitled",
        date: getDate(p["Publish Date"]),
        platform: getSelect(p["Platform"]) || "All",
        pinned: getCheckbox(p["Pinned"]),
        imageSource,
        media,
      };
    })
    // must actually have media to render
    .filter((it) => it.media.length > 0);

    res.status(200).json({ items });
  } catch (err) {
    console.error("API Error:", err);
    res.status(500).json({ error: "Failed to load content." });
  }
}
