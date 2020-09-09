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

export const makeRequest = functions.https.onCall(async (data, context) => {
  const { provider, token, request, session } = data as {
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
    }
    try {
      let res = await (function (): Promise<{ count: number; ttl: number }> {
        return new Promise((resolve, reject) => {
          if (redisClient) {
            redisClient.eval(
              requestLimitScript,
              1,
              "requestId:" + id,
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
      if (res.count > 1) {
        return "rate_limited. retry after: " + res.ttl;
      }
    } catch (e) {
      console.error(e);
      return "error";
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
            authentication: "Bearer " + PUBSUB_SECRET,
          },
        }
      );
      return "ok";
    } catch (e) {
      console.error(e);
      return "failed";
    }
  } catch (e) {
    console.error(e);
    return "invalid token";
  }
});
