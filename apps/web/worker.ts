interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/magic-router" || url.pathname.startsWith("/magic-router/")) {
      url.hostname = "devnet-router.magicblock.app";
      url.protocol = "https:";
      url.port = "";
      url.pathname = url.pathname.slice("/magic-router".length) || "/";

      return fetch(new Request(url, request));
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
