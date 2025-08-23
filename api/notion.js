import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_SECRET });

export default async function handler(req, res) {
  try {
    const databaseId = process.env.NOTION_DATABASE_ID;
    const response = await notion.databases.query({
      database_id: databaseId,
      sorts: [
        {
          property: "Publish Date",
          direction: "descending",
        },
      ],
    });

    // Format into array
    const items = response.results.map((page) => {
      const props = page.properties;

      // Handle name + date safely
      const name =
        props["Name"]?.title?.[0]?.plain_text || "Untitled";
      const publishDate =
        props["Publish Date"]?.date?.start || null;

      // Handle platform safely
      const platform = props["Platform"]?.multi_select?.map(p => p.name) || [];

      // Handle image sources
      const sourceType = props["Image Source"]?.select?.name || null;

      // Collect all media from different fields
      let media = [];

      if (sourceType === "Image Attachment" && props["Attachment"]?.files) {
        media = props["Attachment"].files.map(f => f.file?.url || f.external?.url).filter(Boolean);
      }

      if (sourceType === "Link" && props["Link"]?.url) {
        media.push(props["Link"].url);
      }

      if (sourceType === "Canva Design" && props["Canva Link"]?.url) {
        media.push(props["Canva Link"].url);
      }

      return {
        id: page.id,
        name,
        publishDate,
        platform,
        media,
      };
    });

    res.status(200).json({ items });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch from Notion" });
  }
}
