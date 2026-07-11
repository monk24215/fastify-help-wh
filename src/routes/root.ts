import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { join } from 'path';
import { createReadStream, existsSync } from 'fs';

const root: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Serve public/index.html at "/". public/ sits at repo root (one level up from src/).
  fastify.get('/', async (request, reply) => {
    const p = join(__dirname, '..', '..', 'public', 'index.html');
    if (!existsSync(p)) {
      return reply.code(404).send('index.html not found in public/');
    }
    return reply.type('text/html').send(createReadStream(p));
  });
};

export default root;
