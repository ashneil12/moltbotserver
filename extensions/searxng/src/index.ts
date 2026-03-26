import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/memory-core";

const searxngPlugin = {
  id: "searxng",
  name: "SearXNG Search",
  description: "Web search via SearXNG",
  kind: "web-search" as const,
  configSchema: emptyPluginConfigSchema(),

  register(api: any) {
    if (!api.pluginConfig || !api.pluginConfig.apiUrl) {
      if (api.logger?.debug) {
        api.logger.debug("searxng: apiUrl not configured, skipping registration");
      }
      return;
    }

    const apiUrl = api.pluginConfig.apiUrl;
    const categories = api.pluginConfig.categories || "general";

    api.registerWebSearchProvider({
      id: "searxng",
      async search(params: any) {
        const query = encodeURIComponent(params.query);
        const url = `${apiUrl}/search?q=${query}&format=json&categories=${categories}`;
        
        try {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`SearXNG API error: ${response.status}`);
          }
          
          const data = await response.json();
          
          if (!data || !data.results) {
            return [];
          }
          
          return data.results.slice(0, 10).map((r: any) => ({
            title: r.title || "",
            url: r.url || "",
            description: r.content || "",
          }));
        } catch (error) {
          if (api.logger?.error) {
            api.logger.error(`SearXNG search failed: ${error}`);
          }
          return [];
        }
      }
    });
  }
};

export default searxngPlugin;
