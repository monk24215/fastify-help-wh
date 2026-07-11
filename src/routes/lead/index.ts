import { FastifyInstance, FastifyPluginAsync } from 'fastify';

const lead: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/', async (request, reply) => {
    return 'this is a lead';
  });
};

export default lead;
