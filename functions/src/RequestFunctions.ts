import * as functions from "firebase-functions";
import axios, { AxiosPromise } from "axios";
import redis from "redis";

let PUBSUB_URL: string, PUBSUB_SECRET: string;
let redisClient: redis.RedisClient | undefined;
const requestLimitScript =
  "local c = redis.call('incr',KEYS[1]) if (c ==1) then redis.call('expire', KEYS[1], 100) end return {c, redis.call('ttl', KEYS[1])}";

if (
  process.env.FUNCTIONS_EMULATOR !== "true" ||
  functions.config().pubsub.url
) {
  // make redis client
  redisClient = redis.createClient({
    auth_pass: functions.config().redis.pass,
    host: functions.config().redis.host,
    port: functions.config().redis.port,
  });

  PUBSUB_URL = functions.config().pubsub.url;
  PUBSUB_SECRET = functions.config().pubsub.secret;
} else {
  // if in emulator/dev env, dont send any network calls just log config
  axios.defaults.adapter = (config) => {
    console.log("Axios Request", config);
    return Promise.resolve({
      data: {},
    } as any) as AxiosPromise;
  };
}

type Provider = "youtube" | "twitch";

export const makeRequest = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Session-Token"
  );
  res.set("Access-Control-Max-Age", "7200");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  } else if (req.method !== "POST") {
    res.sendStatus(405);
    return;
  }

  const { provider, token, request, session } = req.body as {
    provider: Provider;
    token: string;
    request: string;
    session: string;
  };
  try {
    let id: string;
    switch (provider) {
      case "youtube":
        let gapiTokenRes = await axios.get<{ email: string }>(
          "https://oauth2.googleapis.com/tokeninfo",
          {
            params: {
              id_token: token,
            },
          }
        );
        id = gapiTokenRes.data.email;
        break;
      case "twitch":
        let twitchAuthTokenRes = await axios.get<{ user_id: string }>(
          "https://id.twitch.tv/oauth2/validate",
          {
            headers: {
              authentication: "Bearer " + token,
            },
          }
        );
        id = twitchAuthTokenRes.data.user_id;
        break;
      default:
        res.status(400).send("invalid provider");
        return;
    }
    try {
      let rateLimit = await (function (): Promise<{
        count: number;
        ttl: number;
      }> {
        return new Promise((resolve, reject) => {
          if (redisClient) {
            redisClient.eval(
              requestLimitScript,
              1,
              "requestRateLimit:" + id,
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
      })();
      if (rateLimit.count > 1) {
        res.set("Retry-After", `${rateLimit.ttl + 1}`);
        res.sendStatus(429);
        return;
      }
    } catch (e) {
      console.error(e);
      res.sendStatus(500);
      return;
    }

    try {
      await axios.get(PUBSUB_URL + "/channels-stats", {
        params: {
          id: session,
        },
      });
      await axios.post(
        PUBSUB_URL + "/pub",
        {
          request,
        },
        {
          params: {
            id: "host_" + session,
          },
          headers: {
            authorization: PUBSUB_SECRET,
          },
        }
      );
      res.sendStatus(200);
      return;
    } catch (e) {
      console.error(e);
      res.sendStatus(500);
      return;
    }
  } catch (e) {
    console.error(e);
    res.status(400).send("invalid token");
    return;
  }
});
