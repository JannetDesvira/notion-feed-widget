import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

// -------- helpers ----------
const getCheckbox = (prop) =>
  !!(prop && typeof prop.checkbox !== "undefined" && prop.checkbox === true);

const getText = (prop) =>
  prop?.rich_text?.[0]?.plain_text || prop?.title?.[0]?.plain_text || "";

const getUrl = (prop) => (prop?.url ? prop.url : getText(prop) || "");

const fileToUrl = (f) => f?.external?.url || f?.file?.url || "";

const guessKindFromUrl = (u) => {
  const url = (u || "").toLowerCase();
  if (url.endsWith(".mp4") || url.endsWith(".mov") || url.includes("video"))
    return "video";
  return "image";
};

export default async function handler(req, res) {
  try {
    const platform = (req.query.platform || "All").trim();

    // pull everything, we’ll filter and sort client-side
    const query = await notion.databases.query({
      database_id: databaseId,
      sorts: [{ property: "Publish Date", direction: "descending" }],
      filter:
        platform && platform !== "All"
          ? {
              property: "Platform",
              select: { equals: platform },
            }
          : undefined,
    });

    let items = query.results.map((page) => {
      const p = page.properties;

      const name =
        p["Name"]?.title?.[0]?.plain_text ||
        p["Name"]?.rich_text?.[0]?.plain_text ||
        "Untitled";

      const date = p["Publish Date"]?.date?.start || null;
      const imageSource = p["Image Source"]?.select?.name || "";
      const pinned = getCheckbox(p["Pinned"]);
      const hide = getCheckbox(p["Hide"]);

      let media = [];
      if (imageSource === "Image Attachment") {
        const files = p["Attachment"]?.files || [];
        media = files
          .map((f) => {
            const url = fileToUrl(f);
            if (!url) return null;
            return {
              type: guessKindFromUrl(url), // image | video
              url,
            };
          })
          .filter(Boolean);
      } else if (imageSource === "Link") {
        const u = getUrl(p["Link"]);
        if (u) media = [{ type: guessKindFromUrl(u), url: u }];
      } else if (imageSource === "Canva Design") {
        const u = getUrl(p["Canva Link"]);
        if (u) media = [{ type: "canva", url: u }];
      }

      return {
        id: page.id,
        name,
        date,
        pinned,
        hide,
        media,
      };
    });

    // filter hidden + must have media
    items = items.filter((it) => !it.hide && it.media && it.media.length);

    // pinned first, then by date desc (we already asked desc, but pin reorders)
    items.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      // both pinned or both not pinned -> keep query order (desc by date)
      return 0;
    });

    res.status(200).json({ items });
  } catch (err) {
    console.error("API Error:", err);
    res.status(500).json({ error: err.message });
  }
}
