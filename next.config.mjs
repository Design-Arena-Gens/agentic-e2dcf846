/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ["https://agentic-e2dcf846.vercel.app"],
      bodySizeLimit: "8mb"
    }
  }
};

export default nextConfig;
