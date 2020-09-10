import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

// // TODO
export const ClearSessions = functions.pubsub
  .schedule("every 1 hour")
  .onRun((context) => {
    const database = admin.database();

    database.ref("rateLimit");
  });

// // TODO
// export const ClearInactiveAccounts = functions.pubsub
//   .schedule("every 1 day")
//   .onRun((context) => {});
