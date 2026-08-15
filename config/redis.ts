import IORedis from 'ioredis';

const { REDIS_HOST, REDIS_PORT, REDIS_USERNAME, REDIS_PASSWORD, NODE_ENV } =
    process.env;

const redis = new IORedis({
    host: REDIS_HOST,
    port: parseInt(REDIS_PORT || '6379', 10),
    username: REDIS_USERNAME,
    password: REDIS_PASSWORD,
    db: NODE_ENV === 'production' ? 1 : 0,
    maxRetriesPerRequest: null,
});
redis.on('connect', () => {
    console.log('Redis connected');
});

redis.on('error', err => {
    console.error('Redis connection error:', err);
    process.exit(1);
});

export default redis;