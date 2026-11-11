import type { NextConfig } from "next";
import { PHONE_DEV_ORIGINS } from "./lib/phone/dev-origins";
import { installPeerStamp } from "./lib/phone/peer-stamp";

// Before the HTTP server listens. The gateway secret is minted in instrumentation,
// which can use the filesystem; this file stays free of fs so the server trace
// does not follow the whole project.
installPeerStamp();

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon — must stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  // Dev assets (/_next, including the websocket) are blocked cross-origin unless named.
  allowedDevOrigins: [...PHONE_DEV_ORIGINS],
};

export default nextConfig;
