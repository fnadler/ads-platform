import type { NextConfig } from "next";

// cacheComponents/partialPrefetching ficam desligados: todas as telas são autenticadas e por
// organização (nada vai para o shell estático), e com eles cada leitura de sessão exigiria um
// <Suspense>. Rotas de API e telas rodam no momento da requisição.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Importação de CSV (a Vercel limita o corpo da requisição a 4,5 MB).
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
