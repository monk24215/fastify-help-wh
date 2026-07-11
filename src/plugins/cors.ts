import fp from 'fastify-plugin';
import cors from '@fastify/cors';

// Page and API are the same origin, so CORS is mostly moot.
// This lets you point API_BASE at a custom domain if you ever split them.
export default fp(async (fastify) => {
  const origin = process.env.ALLOWED_ORIGIN || true;
  fastify.register(cors, { origin, methods: ['GET','POST','OPTIONS'] });
});
