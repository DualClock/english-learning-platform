/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Клиентский router-cache: дольше держит RSC-ответы, поэтому
    // возврат на уже открытую вкладку не ждёт сервер.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
