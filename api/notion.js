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

    // Format into simple array
    const items = response.results.map((page) => {
      const props = page.properties;
      return {
        id: page.id,
        name: props["Name"]?.title?.[0]?.plain_text || "Untitled",
        publishDate: props["Publish Date"]?.date?.start || null,
        imageSource: props["Image Source"]?.select?.name || null,
        attachment: props["Attachment"]?.files || [],
        link: props["Link"]?.rich_text?.[0]?.plain_text || null,
        canva: props["Canva Link"]?.url || null,
        pinned: props["Pinned"]?.checkbox || false,
        hide: props["Hide"]?.checkbox || false,
        platform: props["Platform"]?.select?.name || null,
        status: props["Status"]?.status?.name || null,
      };
    });

    res.status(200).json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch data from Notion" });
  }
}
