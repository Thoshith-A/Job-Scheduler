/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // three.js ships ESM; make sure it is transpiled for the Next server bundle.
  transpilePackages: ["three"],
};

module.exports = nextConfig;
