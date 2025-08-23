import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_SECRET });

export default async function handler(req, res) {
  try {
    const databaseId = process.env.NOTION_DATABASE_ID;

    // Optional filter: /api/notion?platform=Instagram
    const url = new URL(req.url, "http://localhost");
    const platformFilter = url.searchParams.get("platform");

    const filter = {
      and: [
        { property: "Hide", checkbox: { equals: false } },
        ...(platformFilter
          ? [{ property: "Platform", select: { equals: platformFilter } }]
          : []),
      ],
    };

    const query = await notion.databases.query({
      database_id: databaseId,
      filter,
      sorts: [
        { property: "Pinned", direction: "descending" },
        { property: "Publish Date", direction: "descending" },
      ],
      page_size: 100,
    });

    const items = query.results.map((page) => {
      const p = page.properties || {};

      const name =
        p["Name"]?.title?.[0]?.plain_text ??
        p["Name"]?.title?.map((t) => t.plain_text).join("") ??
        "Untitled";

      const publishDate = p["Publish Date"]?.date?.start ?? null;
      const imageSource = p["Image Source"]?.select?.name ?? "Image Attachment";
      const pinned = !!p["Pinned"]?.checkbox;
      const hide = !!p["Hide"]?.checkbox;
      const platform = p["Platform"]?.select?.name ?? null;
      const status =
        p["Status"]?.select?.name || p["Status"]?.status?.name || null;

      // files from Attachment
      const attachments =
        (p["Attachment"]?.files ?? [])
          .map((f) => f.file?.url || f.external?.url)
          .filter(Boolean) || [];

      // multiple URLs in Link (newline separated)
      const linkText =
        (p["Link"]?.rich_text ?? [])
          .map((t) => t.plain_text)
          .join("\n") || "";
      const links = linkText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      const canva = p["Canva Link"]?.url || "";

      // choose media by Image Source
      let media = [];
      if (imageSource === "Image Attachment") media = attachments;
      else if (imageSource === "Link") media = links;
      else if (imageSource === "Canva Design" && canva) media = [canva];

      return {
        id: page.id,
        name,
        publishDate,
        pinned,
        hide,
        platform,
        status,
        source: imageSource,
        media, // array of URLs
      };
    });

    const visible = items.filter((it) => !it.hide && it.media.length);
    res.status(200).json({ items: visible });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch data from Notion" });
  }
}
