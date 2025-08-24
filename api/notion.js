// api/notion.js
import { Client } from "@notionhq/client";

function safeText(p) {
  // Notion "Title" returns rich_text array under .title
  if (!p) return null;
  const t = p.title || p.rich_text || [];
  return t.map((r) => r.plain_text || "").join("").trim() || null;
}

function getSelectName(p) {
  // Notion "Select" returns { name }
  return p?.select?.name || null;
}

function getCheckbox(p) {
  return Boolean(p?.checkbox);
}

function getDate(p) {
  // Notion "Date" returns { start }
  return p?.date?.start || null;
}

function getMultiUrlsFromText(p) {
  // Notion "URL" or "Text" property may exist; handle both gracefully
  const val = p?.url ?? (p?.rich_text || []).map(r => r.plain_text).join("\n");
  if (!val) return [];
  return String(val)
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

function getFiles(p) {
  // Notion "Files & media" (attachments)
  const files = p?.files || [];
  return files
    .map((f) => {
      if (f.type === "file") return f.file?.url;
      if (f.type === "external") return f.external?.url;
      return null;
    })
    .filter(Boolean);
}

export default async function handler(req, res) {
  const { debug, platform } = req.query;

  try {
    const notionSecret = process.env.NOTION_SECRET;
    const databaseId   = process.env.NOTION_DATABASE_ID;

    // Helpful preflight checks
    if (!notionSecret || !databaseId) {
      return res.status(500).json({
        ok: false,
        reason: "Missing environment variables",
        need: {
          NOTION_SECRET: Boolean(notionSecret),
          NOTION_DATABASE_ID: Boolean(databaseId),
        },
      });
    }

    const notion = new Client({ auth: notionSecret });

    // Build optional filters:
    // - Hide != true
    // - Platform equals ?platform (if provided and not 'All')
    const andFilters = [
      {
        or: [
          { property: "Hide", checkbox: { equals: false } },
          { property: "Hide", checkbox: { is_empty: true } },
        ],
      },
    ];

    if (platform && platform !== "All") {
      andFilters.push({
        property: "Platform",
        select: { equals: platform },
      });
    }

    // Query the DB
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: { and: andFilters },
      sorts: [
        // Pinned first (true before false)
        { property: "Pinned", direction: "descending" },
        // Then newest date first
        { property: "Publish Date", direction: "descending" },
      ],
      page_size: 100,
    });

    // Map results into a simple shape
    const items = response.results.map((page) => {
      const props = page.properties || {};

      const name        = safeText(props["Name"]) || "(Untitled)";
      const publishDate = getDate(props["Publish Date"]);
      const imageSource = getSelectName(props["Image Source"]); // "Image Attachment" | "Link" | "Canva Design"
      const platformSel = getSelectName(props["Platform"]) || "Unspecified";
      const pinned      = getCheckbox(props["Pinned"]);
      const hidden      = getCheckbox(props["Hide"]);

      // Collect media, in priority order based on imageSource
      const attachmentUrls = getFiles(props["Attachment"]); // array
      const linkUrls       = getMultiUrlsFromText(props["Link"]); // array
      const canvaUrl       = (props["Canva Link"]?.url) || null;

      // Build a unified media list
      let media = [];
      if (imageSource === "Image Attachment") {
        media = [...attachmentUrls, ...linkUrls];
      } else if (imageSource === "Link") {
        media = [...linkUrls, ...attachmentUrls];
      } else if (imageSource === "Canva Design" && canvaUrl) {
        media = [canvaUrl, ...attachmentUrls, ...linkUrls];
      } else {
        // Fallback if the select isn't set
        media = [...attachmentUrls, ...linkUrls];
        if (canvaUrl) media.unshift(canvaUrl);
      }

      // Keep only unique & http(s) urls
      const seen = new Set();
      media = media.filter((u) => {
        if (!/^https?:\/\//i.test(u)) return false;
        if (seen.has(u)) return false;
        seen.add(u);
        return true;
      });

      // The card "cover" (first media) for the grid
      const cover = media[0] || null;

      return {
        id: page.id,
        name,
        publishDate,
        imageSource,
        platform: platformSel,
        pinned,
        hidden,
        cover,
        media, // all media for lightbox
      };
    });

    // Return JSON success
    const payload = { ok: true, count: items.length, items };

    if (debug) {
      // Helpful diagnostics if you open /api/notion?debug=1
      payload.debug = {
        databaseId,
        platformParam: platform || "All",
        propertyKeysSeen:
          response.results[0]?.properties
            ? Object.keys(response.results[0].properties)
            : [],
      };
    }

    return res.status(200).json(payload);
  } catch (err) {
    const msg = err?.message || String(err);
    const status = err?.status || 500;

    // Send a readable error
    return res.status(status).json({
      ok: false,
      error: msg,
      hint:
        "Open your DB and confirm the property names exactly: Name (Title), Publish Date (Date), Image Source (Select), Attachment (Files & media), Link (URL or Text), Canva Link (URL), Pinned (Checkbox), Hide (Checkbox), Platform (Select). Also confirm integration access.",
      stack: process.env.NODE_ENV === "production" ? undefined : err?.stack,
    });
  }
}
