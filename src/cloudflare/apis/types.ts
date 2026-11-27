/** Opt-in types for the Cloudflare API implemented by the browser adapter. */
declare module "cloudflare:node" {
  export const handleAsNodeRequest: typeof import("./cloudflare-node/index.js").handleAsNodeRequest;
  export const handleAsNodeConnection: typeof import("./cloudflare-node/index.js").handleAsNodeConnection;
  export const connectHandler: typeof import("./cloudflare-node/index.js").connectHandler;
  export const httpServerHandler: typeof import("./cloudflare-node/index.js").httpServerHandler;
}

declare module "cloudflare:workers" {
  export const env: typeof import("./cloudflare-workers/index.js").env;
  export type DurableObject<Env = unknown> =
    import("./cloudflare-workers/index.js").DurableObject<Env>;
  export const DurableObject: typeof import("./cloudflare-workers/index.js").DurableObject;
}
