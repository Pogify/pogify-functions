import * as functions from "firebase-functions";
import redis from "redis";

const requestLimitScript =
  "local c = redis.call('incr',KEYS[1]) if (c == 1) then redis.call('expire', KEYS[1], ARGV[1]) end return {c, redis.call('ttl', KEYS[1])}";

const apiLimits = {
  interval: 5 * 60,
  count: 100,
  sessionTTL: 60 * 60,
} as const;

let redisClient: redis.RedisClient | undefined;
if (functions.config().redis) {
  redisClient = redis.createClient({
    host: functions.config().redis.host,
    port: functions.config().redis.port,
    auth_pass: functions.config().redis.pass,
  });
}

export const RateLimit = (uid: string) => {
  return new Promise((resolve, reject) => {
    if (!redisClient) return resolve();

    redisClient.eval(
      requestLimitScript,
      1,
      "rateLimit:" + uid,
      apiLimits.interval,
      (err, res) => {
        if (err) {
          resolve();
        } else {
          const count = res[0] as number;
          const ttl = res[1] as number;
          if (count > apiLimits.count) {
            const err = new Error("too many calls");

            // @ts-expect-error
            err.retryAfter = ttl + 1;
            reject(err);
          } else {
            resolve();
          }
        }
      }
    );
  });
};

export function checkSessionTTL(sessionId: string) {
  return new Promise((resolve, reject) => {
    if (!redisClient) return resolve(1);

    redisClient.ttl("session:" + sessionId, (err, res) => {
      if (err) {
        return reject(err);
      } else {
        resolve(res);
      }
    });
  });
}

const newSessionScript = `
                          local c = redis.call("ttl", KEYS[1])
                          if (c < 0) then 
                            redis.call("set", KEYS[1], ARGV[1])
                            redis.call("expire", KEYS[1], ARGV[2])
                            return 1
                            end
                          return 0
                        `;

export function newSession(
  sessionId: string,
  refreshToken: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!redisClient) return resolve(1);

    redisClient.eval(
      newSessionScript,
      1,
      "session:" + sessionId,
      refreshToken,
      apiLimits.sessionTTL,
      (err, res) => {
        if (err) reject(err);
        else resolve(res);
      }
    );
  });
}

export function touchSession(sessionId: string) {
  return new Promise((resolve, reject) => {
    if (!redisClient) return resolve(1);

    redisClient.EXPIRE(
      "session:" + sessionId,
      apiLimits.sessionTTL,
      (err, res) => {
        if (err) reject(err);
        else resolve(res);
      }
    );
  });
}
