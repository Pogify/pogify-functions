import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

import axios, { AxiosPromise } from "axios";
import * as jwt from "jsonwebtoken";
import { nanoid, customAlphabet } from "nanoid";
// import { validateBody } from "./ValidateBody";
// import fastJson from "fast-json-stringify";
import * as RedisMethods from "./RedisMethods";

const __SECRET = functions.config().jwt.secret;
let PUBSUB_URL: string, PUBSUB_SECRET: string;

// if running on the emulator ignore pubsub secrets
if (process.env.FUNCTIONS_EMULATOR !== "true" || functions.config().pubsub) {
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

const sessionCodeGenerator = customAlphabet(
  "abcdefghijklmnopqrstuwxyz0123456789-",
  5
);
// const payloadStringify = fastJson({
//   title: "pubmessage",
//   type: "object",
//   properties: {
//     timestamp: {
//       type: "number",
//     },
//     track_window: {
//       type: "array",
//     },
//     uri: {
//       type: "string",
//     },
//     position: {
//       type: "number",
//     },
//     playing: {
//       type: "boolean",
//     },
//   },
// });

const auth = admin.auth();

export const startSession = functions.https.onRequest(async (req, res) => {
  // FIXME: proper cors
  res.set("Access-Control-Allow-Origin", "*");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Session-Token"
  );
  res.set("Access-Control-Max-Age", "7200");

  // if incoming request is not json: reject
  if (
    !req.get("content-type")?.match(/application\/json/) &&
    Object.keys(req.body).length
  ) {
    res.sendStatus(415);
    return;
  }

  // if incoming request is not POST: reject
  // if incoming request is OPTIONS
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  if (req.method !== "POST") {
    res.sendStatus(405);
    return;
  }

  // if running emulator ignore auth
  if (process.env.FUNCTIONS_EMULATOR !== "true") {
    // validate auth
    if (!req.headers.authorization) {
      res.sendStatus(401);
      return;
    } else {
      let user: admin.auth.DecodedIdToken;
      try {
        user = await auth.verifyIdToken(
          req.headers.authorization.split("Bearer ")[1]
        );
      } catch (e) {
        console.info(e);
        res.sendStatus(401);
        return;
      }
      try {
        await RedisMethods.RateLimit(user.uid);
      } catch (e) {
        if (e.message === "too many calls") {
          console.error(e);
          res.setHeader("Retry-After", e.retryAfter);
          res.sendStatus(429);
          return;
        }
      }
    }
  }

  // generate session code and check for duplicates
  let sessionCode: string;
  const refreshToken = nanoid(64);
  while (true) {
    sessionCode = sessionCodeGenerator();

    const result = await RedisMethods.newSession(sessionCode, refreshToken);

    if (result) {
      break;
    }
  }

  // sign jwt, ttl: 30 min
  const token = jwt.sign(
    {
      session: sessionCode,
    },
    __SECRET,
    {
      expiresIn: "30m",
      subject: "session",
    }
  );

  // if an initial post exists, push to pubsub
  if (Object.keys(req.body).length) {
    try {
      // validate body of initial post
      // const payload = validateBody(req.body);
      const payload = req.body;

      // FIXME: set and forget for now
      axios
        .post(PUBSUB_URL + "/pub", JSON.stringify(payload), {
          headers: {
            Authorization: PUBSUB_SECRET,
          },
          params: {
            id: sessionCode,
          },
        })
        .catch(console.error);
      // TODO: should implement retries and stuff like that
    } catch (reason) {
      // error on body validation
      res.status(400).send(reason);
    }
    // return token, session code and expireAt in seconds
  }
  res.status(201).send({
    token,
    session: sessionCode,
    refreshToken,
    expiresIn: 30 * 60,
  });
});

export const postUpdate = functions.https.onRequest(async (req, res) => {
  // FIXME: proper cors
  res.set("Access-Control-Allow-Origin", "*");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Session-Token"
  );
  res.set("Access-Control-Max-Age", "7200");

  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  // reject if not post
  if (req.method !== "POST") {
    res.sendStatus(405);
    return;
  }

  // If running dev environment (ie. emulator) ignore auth
  if (process.env.FUNCTIONS_EMULATOR !== "true") {
    // validate auth
    if (!req.headers.authorization) {
      res.sendStatus(401);
      return;
    } else {
      let user: admin.auth.DecodedIdToken;
      try {
        user = await auth.verifyIdToken(
          req.headers.authorization.split("Bearer ")[1]
        );
      } catch (e) {
        res.sendStatus(401);
        return;
      }
      try {
        await RedisMethods.RateLimit(user.uid);
      } catch (e) {
        if (e.message === "too many calls") {
          console.error(e);
          res.setHeader("Retry-After", e.retryAfter);

          res.sendStatus(429);
          return;
        }
      }
    }
  }

  // reject on no session token
  if (!req.headers["x-session-token"]) {
    res.sendStatus(403);
    return;
  }

  // reject if not json
  if (req.headers["content-type"] !== "application/json") {
    res.sendStatus(415);
    return;
  }

  if (Object.keys(req.body).length === 0 && req.body.constructor === Object) {
    res.status(400).send("empty body");
  }
  try {
    // verify jwt
    const jwtPayload = jwt.verify(
      req.headers["x-session-token"] as string,
      __SECRET
    ) as {
      session: string;
    };

    try {
      // validate body
      // const payload = validateBody(req.body);
      const payload = req.body;

      // FIXME: set and forget for now
      const stats = await axios
        .post(PUBSUB_URL + "/pub", JSON.stringify(payload), {
          headers: {
            Authorization: PUBSUB_SECRET,
          },
          params: {
            id: jwtPayload.session,
          },
        })
        .catch(console.error);
      // respond ok
      if (stats) {
        res.status(200).send(stats.data);
      } else {
        res.sendStatus(500);
      }
    } catch (reason) {
      // reject on malformed body
      res.status(400).send(reason);
    }
  } catch (e) {
    // reject on bad jwt
    res.sendStatus(401);
  }
});

export const refreshToken = functions.https.onRequest(async (req, res) => {
  // FIXME: proper cors
  res.set("Access-Control-Allow-Origin", "*");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization,X-Session-Token"
  );
  res.set("Access-Control-Max-Age", "7200");

  // send 200 on OPTION
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }

  // ignore authentication if in dev env (ie emulator)
  if (process.env.FUNCTIONS_EMULATOR !== "true") {
    // validate auth
    if (!req.headers.authorization) {
      // if no authorization reject
      res.sendStatus(401);
      return;
    } else {
      let user: admin.auth.DecodedIdToken;
      try {
        // verify the token
        user = await auth.verifyIdToken(
          req.headers.authorization.split("Bearer ")[1]
        );
      } catch (e) {
        // fail to verify reject
        res.sendStatus(401);
        return;
      }
      try {
        // send uid to rate limiter
        await RedisMethods.RateLimit(user.uid);
      } catch (e) {
        if (e.message === "too many calls") {
          console.error(e);
          res.setHeader("Retry-After", e.retryAfter);

          res.sendStatus(429);
          return;
        }
      }
    }
  }

  // reject on no session token
  if (!req.headers["x-session-token"]) {
    res.sendStatus(403);
    return;
  }

  try {
    // get old payload
    const oldPayload = jwt.verify(
      req.headers["x-session-token"] as string,
      __SECRET,
      {
        ignoreExpiration: true,
      }
    ) as {
      exp: number;
      session: string;
    };
    // check that payload is within refresh window
    // issue new token
    const newToken = jwt.sign(
      {
        session: oldPayload.session,
      },
      __SECRET,
      {
        expiresIn: "30m",
        subject: "session",
      }
    );
    const newRefreshToken = nanoid(64);
    if (req.query.refreshToken) {
      let redisRes = await RedisMethods.verifyAndSetNewRefreshToken(
        oldPayload.session,
        req.query.refreshToken as string,
        newRefreshToken
      );
      if (redisRes === 0) {
        res.status(401).send("invalid refresh token");
        return;
      } else if (redisRes === -1) {
        res.status(400).send("token expired");
        return;
      }
    } else {
      await RedisMethods.touchSession(oldPayload.session);
    }

    // respond with token
    res.status(200).send({
      token: newToken,
      refreshToken: newRefreshToken,
      session: oldPayload.session,
      expiresIn: 30 * 60,
    });
  } catch (e) {
    console.error(e);
    // reject if malformed, or expired jwt
    res.status(401).send("invalid jwt");
  }
});
