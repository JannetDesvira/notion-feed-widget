import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

// helper: safe checkbox reader
const getCheckbox = (prop) => {
  if (!prop || typeof prop.checkbox === "undefined") return false;
  return prop.checkbox === true;
};

// helper: safe text reader
const getText = (prop) => {
  if (!prop || !prop.rich_text || !prop.rich_text[0]) return "";
  return prop.rich_text[0].plain_text;
};

// helper: safe URL reader
const getUrl = (prop) => {
  if (!prop) return "";
  return prop.url || getText(prop);
};

// helper: files & media
const getFiles = (prop) => {
  if (!prop || !prop.files) return [];
  return prop.files.map((f) => f.external?.url || f.file?.url).filter(Boolean);
};

export default async function handler(req, res) {
  try {
    const query = await notion.databases.query({
      database_id: databaseId,
      sorts: [{ property: "Publish Date", direction: "ascending" }],
    });

    let items = query.results.map((page) => {
      const props = page.properties;
      const imageSource = props["Image Source"]?.select?.name || "";
      let media = [];

      if (imageSource === "Image Attachment") {
        media = getFiles(props["Attachment"]);
      } else if (imageSource === "Link") {
        media = [getUrl(props["Link"])].filter(Boolean);
      } else if (imageSource === "Canva Design") {
        media = [getUrl(props["Canva Link"])].filter(Boolean);
      }

      return {
        id: page.id,
        name: props["Name"]?.title?.[0]?.plain_text || "Untitled",
        date: props["Publish Date"]?.date?.start || null,
        platform: props["Platform"]?.select?.name || "All",
        pinned: getCheckbox(props["Pinned"]),
        hide: getCheckbox(props["Hide"]),
        media,
      };
    });

    // filter hidden + items with no media
    items = items.filter((it) => !it.hide && it.media.length > 0);

    // pinned at top, rest follow
    items.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });

    res.status(200).json({ items });
  } catch (err) {
    console.error("API Error:", err);
    res.status(500).json({ error: err.message });
  }
}

