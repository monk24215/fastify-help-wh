import { FastifyInstance, FastifyPluginAsync } from 'fastify';

const ask: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/', async (request, reply) => {
    return 'this is an ask';
  });
};

export default ask;
