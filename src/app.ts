import Fastify from 'fastify';
import AutoLoad, { AutoloadPluginOptions } from '@fastify/autoload';
import cors from '@fastify/cors';
import { join } from 'path';

const fastify = Fastify({ logger: true });

fastify.register(cors, {
  origin: process.env.ALLOWED_ORIGIN || true,
  methods: ['GET', 'POST', 'OPTIONS'],
});

const pluginOptions: Partial<AutoloadPluginOptions> = {};

fastify.register(AutoLoad, {
  dir: join(__dirname, 'plugins'),
  options: pluginOptions,
});

fastify.register(AutoLoad, {
  dir: join(__dirname, 'routes'),
  options: pluginOptions,
});

fastify.listen({ host: '::', port: Number(process.env.PORT) || 3000 }, function (err, address) {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
