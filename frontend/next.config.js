/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Evita fallos de build por tipos estrictos en CI (opcional)
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

module.exports = nextConfig;
