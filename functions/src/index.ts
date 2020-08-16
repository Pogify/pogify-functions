import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import "firebase-functions";
import * as jwt from "jsonwebtoken";
import { customAlphabet } from "nanoid";
import { validateBody } from "./ValidateBody";

admin.initializeApp();
// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//

const __SECRET = functions.config().jwt.secret;

export const helloWorld = functions.https.onRequest((request, response) => {
  functions.logger.info("Hello logs!", { structuredData: true });
  response.send("Hello from Firebase!");
});

export const startSession = functions.https.onRequest(async (req, res) => {
  let sessionCode = customAlphabet("abcdefghijklmnopqrstuwxyz0123456789", 5)();
  let token = jwt.sign(
    {
      session: sessionCode,
    },
    __SECRET,
    {
      expiresIn: "30m",
    }
  );
  try {
    await validateBody(req.body);

    try {
      let { timestamp, uri, position, playing } = req.body;

      await admin.database().ref(sessionCode).set({
        timestamp,
        uri,
        position,
        playing,
      });
      res.send({
        token,
        session: sessionCode,
        expiresIn: 30 * 60 * 1000,
      });
    } catch (e) {
      console.error(e);
    }
  } catch (reason) {
    res.status(400).send(reason);
  }
});
export const postUpdate = functions.https.onRequest((req, res) => {});
export const refreshToken = functions.https.onRequest((req, res) => {});
export const getInitial = functions.https.onRequest((req, res) => {});
