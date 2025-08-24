import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

/* ---------- helpers ---------- */
const isTrue = (prop) => !!(prop && typeof prop.checkbox !== "undefined" && prop.checkbox);
const rt = (prop) => (prop?.rich_text?.[0]?.plain_text ?? "");
const urlish = (prop) => (prop?.url ?? rt(prop) ?? "");

const fileUrls = (prop) => {
  if (!prop?.files) return [];
  return prop.files
    .map((f) => f.external?.url || f.file?.url)
    .filter(Boolean);
};

const guessKind = (u) => {
  const s = (u || "").toLowerCase();
  if (s.includes("canva.com")) return "canva";
  if (s.match(/\.(mp4|mov|webm|m4v)(\?|$)/)) return "video";
  return "image";
};

export default async function handler(req, res) {
  try {
    const filterParts = [
      { property: "Hide", checkbox: { equals: false } }, // ok if property missing -> Notion treats as false
    ];

    const platform = (req.query.platform || "").trim();
    if (platform && platform.toLowerCase() !== "all") {
      filterParts.push({
        property: "Platform",
        select: { equals: platform },
      });
    }

    const query = await notion.databases.query({
      database_id: databaseId,
      filter: { and: filterParts },
      sorts: [{ property: "Publish Date", direction: "descending" }],
    });

    const items = query.results.map((page) => {
      const p = page.properties;
      const source = p["Image Source"]?.select?.name || "";
      let media = [];

      if (source === "Image Attachment") {
        media = fileUrls(p["Attachment"]);
      } else if (source === "Link") {
        const u = urlish(p["Link"]);
        if (u) media = [u];
      } else if (source === "Canva Design") {
        const u = urlish(p["Canva Link"]);
        if (u) media = [u];
      }

      // label/type for each media
      const mediaTyped = media.map((u) => ({ url: u, kind: guessKind(u) }));

      return {
        id: page.id,
        name: p["Name"]?.title?.[0]?.plain_text || "Untitled",
        date: p["Publish Date"]?.date?.start || null,
        platform: p["Platform"]?.select?.name || "All",
        pinned: isTrue(p["Pinned"]),
        media: mediaTyped,
      };
    })
    // no empty cards
    .filter((it) => it.media.length > 0);

    // pinned first, then by date desc (already desc, but keep stable)
    items.sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1));

    res.status(200).json({ items });
  } catch (err) {
    console.error("API Error:", err);
    res.status(500).json({ error: "Failed to read Notion data" });
  }
}
