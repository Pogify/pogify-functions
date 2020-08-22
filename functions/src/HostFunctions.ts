import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const database = admin.database();

import axios, { AxiosPromise } from "axios";
import * as jwt from "jsonwebtoken";
import { customAlphabet } from "nanoid";
import { validateBody } from "./ValidateBody";
import fastJson from "fast-json-stringify";
import { RateLimit } from "./RateLimiter";

let __SECRET = functions.config().jwt.secret;
let PUBSUB_URL: string, PUBSUB_SECRET: string;

// if running on the emulator ignore pubsub secrets
if (process.env.FUNCTIONS_EMULATOR !== "true") {
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

const nanoid = customAlphabet("abcdefghijklmnopqrstuwxyz0123456789-", 5);
const payloadStringify = fastJson({
  title: "pubmessage",
  type: "object",
  properties: {
    timestamp: {
      type: "number",
    },
    uri: {
      type: "string",
    },
    position: {
      type: "number",
    },
    playing: {
      type: "boolean",
    },
  },
});

const auth = admin.auth();

export const startSession = functions.https.onRequest(async (req, res) => {
  // FIXME: proper cors
  res.set("Access-Control-Allow-Origin", "*");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Session-Token"
  );

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
        await RateLimit(user.uid);
      } catch (e) {
        if (e.message === "too many calls") {
          console.error(e);
          res.sendStatus(429);
          return;
        }
      }
    }
  }

  // generate session code and check for duplicates
  let sessionCode: string;
  while (true) {
    sessionCode = nanoid();

    // check if session exists
    const collRef = database.ref("sessionCodes");
    const codeRef = collRef.child(sessionCode);
    const codeSnap = await codeRef.once("value");
    const timestamp = codeSnap.val();
    // if snapshot doesn't return a timestamp session doesn't exist
    // if code snapshot returns a value and that value is older than 65 min then session is stale and can start a new session with the same id
    if (timestamp && Date.now() / 1000 - timestamp > 65 * 60) {
      // set timestamp in db
      codeRef.set(admin.database.ServerValue.TIMESTAMP);
      break;
    } else if (timestamp) {
      // if timestamp exists and doesn't meet the stale threshold, generate a new code.
      continue;
    } else {
      // set timestamp in db if timestamp doesn't exist
      codeRef.set(admin.database.ServerValue.TIMESTAMP);
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
      const payload = validateBody(req.body);

      // FIXME: set and forget for now
      axios
        .post(PUBSUB_URL + "/pub", payloadStringify(payload), {
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
        await RateLimit(user.uid);
      } catch (e) {
        if (e.message === "too many calls") {
          console.error(e);
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
      const payload = validateBody(req.body);

      // FIXME: set and forget for now
      axios
        .post(PUBSUB_URL + "/pub", payloadStringify(payload), {
          headers: {
            Authorization: PUBSUB_SECRET,
          },
          params: {
            id: jwtPayload.session,
          },
        })
        .catch(console.error);
      // respond ok
      res.sendStatus(200);
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
        await RateLimit(user.uid);
      } catch (e) {
        if (e.message === "too many calls") {
          console.error(e);
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
    if (Date.now() / 1000 - oldPayload.exp < 30 * 60) {
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

      // touch timestamp in session registry
      const collRef = database.ref("sessionCodes");
      const codeRef = collRef.child(oldPayload.session);
      const codeTime = (await codeRef.once("value")).val();

      // if too early then return too early
      if (Date.now() - codeTime < 25 * 60 * 1000) {
        res.status(425);
        return;
      }
      await codeRef.set(admin.database.ServerValue.TIMESTAMP);

      // respond with token
      res.status(201).send({
        token: newToken,
        session: oldPayload.session,
        expiresIn: 30 * 60,
      });
    } else {
      // reject if outside refresh window
      res.status(403).send("token exceed refresh window");
    }
  } catch (e) {
    // reject if malformed, or expired jwt
    res.sendStatus(401);
  }
});
