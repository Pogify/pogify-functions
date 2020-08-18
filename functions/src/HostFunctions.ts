import * as functions from "firebase-functions";
import axios from "axios";
import * as jwt from "jsonwebtoken";
import { customAlphabet } from "nanoid";
import { validateBody } from "./ValidateBody";
import fastJson from "fast-json-stringify";
// let credentials = require("./functions/pogify-database-aa54bd143a77.json");

const __SECRET = functions.config().jwt.secret;
const PUBSUB_URL = functions.config().pubsub.url;

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

export const startSession = functions.https.onRequest(async (req, res) => {
  // if incoming request is not json: reject
  if (req.get("content-type") !== "application/json") {
    res.sendStatus(415);
    return;
  }

  // if incoming request is not POST: reject
  if (req.method !== "POST") {
    res.sendStatus(405);
    return;
  }

  // generate session code and check for duplicates
  let sessionCode = "test123";
  while (true) {
    sessionCode = nanoid();

    // check if session exists
    try {
      break;
    } catch (e) {
      // if exists generate new code and check again
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
  if (req.body) {
    try {
      // validate body of initial post
      const payload = validateBody(req.body);

      // set and forget for now
      axios
        .post(PUBSUB_URL + "/pub", payloadStringify(payload), {
          params: {
            id: sessionCode,
          },
        })
        .catch(console.error);
      // TODO: should implement a second function that deals with pub to nginx (retries and stuff like that)
      // dont want to slow down the request response just because a network call is slow
    } catch (reason) {
      // error on body validation
      res.status(400).send(reason);
    }
    // return token, session code and expireAt in seconds
    res.status(201).send({
      token,
      session: sessionCode,
      expiresIn: 30 * 60,
    });
  }
});

export const postUpdate = functions.https.onRequest(async (req, res) => {
  // reject if no authorization
  if (!req.headers.authorization) {
    res.sendStatus(401);
    return;
  }

  // reject if not post
  if (req.method !== "POST") {
    res.sendStatus(405);
    return;
  }

  try {
    // verify jwt
    let jwtPayload = jwt.verify(
      req.headers.authorization.replace(/bearer /i, ""),
      __SECRET
    ) as { session: string };

    try {
      // validate body
      const payload = validateBody(req.body);

      // set and forget for now
      axios
        .post(PUBSUB_URL + "/pub", payloadStringify(payload), {
          params: {
            id: jwtPayload.session,
          },
        })
        .then(() => {
          res.sendStatus(200);
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

export const refreshToken = functions.https.onRequest((req, res) => {
  // reject on no authorization
  if (!req.headers.authorization) {
    res.sendStatus(401);
    return;
  }

  try {
    // get old payload
    let oldPayload = jwt.verify(
      req.headers.authorization.replace(/bearer /i, ""),
      __SECRET
    ) as { exp: number; session: string };

    // check that payload is within refresh window
    if (oldPayload.exp > Date.now() / 1000 - 30 * 60) {
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

      // respond with token
      res.status(200).send(newToken);
    } else {
      // reject if outside refresh window
      res.status(403).send("token exceed refresh window");
    }
  } catch (e) {
    // reject if malformed jwt
    res.sendStatus(401);
  }
});
