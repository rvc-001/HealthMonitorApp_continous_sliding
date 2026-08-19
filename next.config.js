/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true, 
  },
  trailingSlash: true, 

  // Windows environments sometimes fail to spawn the TS/ESLint validators during `next build`
  // (e.g. EPERM). We skip them for release packaging; run `npm run lint` and `tsc --noEmit`
  // separately in CI/dev if you want strict enforcement.
  typescript: {
    ignoreBuildErrors: true,
  },
  
  // Keep your existing Webpack configuration for ONNX WASM
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'onnxruntime-web/webgpu': false,
    };

    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });

    return config;
  },
};

module.exports = nextConfig;
