import * as functions from "firebase-functions";
import redis from "redis";

const apiLimits = {
  interval: 5 * 60,
  count: 100,
  sessionTTL: 60 * 60,
  requestInterval: 100,
} as const;

let redisClient: redis.RedisClient | undefined;
if (functions.config().redis) {
  redisClient = redis.createClient({
    host: functions.config().redis.host,
    port: functions.config().redis.port,
    auth_pass: functions.config().redis.pass,
  });
}
const apiLimitScript =
  "local c = redis.call('incr',KEYS[1]) if (c == 1) then redis.call('expire', KEYS[1], ARGV[1]) end return {c, redis.call('ttl', KEYS[1])}";

export const RateLimit = (uid: string) => {
  return new Promise((resolve, reject) => {
    if (!redisClient) return resolve();

    redisClient.eval(
      apiLimitScript,
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

export function incRequest(
  id: string
): Promise<{
  count: number;
  ttl: number;
}> {
  return new Promise((resolve, reject) => {
    if (!redisClient) {
      return resolve({
        count: -1,
        ttl: 100,
      });
    }

    if (redisClient) {
      redisClient.eval(
        apiLimitScript,
        1,
        "requestRateLimit:" + id,
        apiLimits.requestInterval,
        (err, ret) => {
          if (err) reject(err);
          else
            resolve({
              count: ret[0],
              ttl: ret[1],
            });
        }
      );
    } else {
      resolve({
        count: -1,
        ttl: 100,
      });
    }
  });
}

const verifyAndSetScript = `
  local t = redis.call("get", KEYS[1])
  if (t == false) then
    return -1
  end
  if (t == ARGV[1]) then
    redis.call("set", KEYS[1], ARGV[2])
    redis.call("expire", KEYS[1], ARGV[3])
    return 1
  end
  return 0 
  `;

export function verifyAndSetNewRefreshToken(
  sessionId: string,
  token: string,
  newToken: string
) {
  return new Promise((resolve, reject) => {
    if (!redisClient) return resolve(1);

    redisClient.eval(
      verifyAndSetScript,
      1,
      "session:" + sessionId,
      token,
      newToken,
      (err, res) => {
        if (err) reject(err);
        else resolve(res);
      }
    );
  });
}
