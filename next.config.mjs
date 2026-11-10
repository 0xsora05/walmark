import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // These SDKs run on the server only (the Walrus one loads WebAssembly); keep them out of the bundle.
  serverExternalPackages: ['@mysten-incubation/memwal', '@mysten/walrus', '@mysten/walrus-wasm', '@mysten/sui'],
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};

export default nextConfig;
