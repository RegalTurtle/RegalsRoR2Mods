import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ccdn.thunderstore.io",
        pathname: "/live/repository/icons/**",
      },
      {
        protocol: "https",
        hostname: "gcdn.thunderstore.io",
        pathname: "/live/repository/icons/**",
      },
      {
        protocol: "https",
        hostname: "thunderstore.io",
        pathname: "/package-icon/**",
      },
      {
        protocol: "https",
        hostname: "thunderstore.io",
        pathname: "/c/**/package-icon/**",
      },
    ],
  },
};

export default nextConfig;
