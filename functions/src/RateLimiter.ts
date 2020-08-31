import * as admin from "firebase-admin";

const database = admin.database();

const apiLimits = {
  interval: 5 * 60 * 1000,
  count: 100,
} as const;

export const RateLimit = async (uid: string) => {
  const userRef = database.ref("rateLimit");
  const uidRef = userRef.child(uid);
  const uidSnap = await uidRef.once("value");

  // if the uid resource doesnt exist set and continue
  if (!uidSnap.exists()) {
    await uidRef.set({
      timestamp: admin.database.ServerValue.TIMESTAMP,
      count: 1,
    });
    return;
  }

  // get timestamp and count from uid snapshot
  const { timestamp, count } = uidSnap.val() as {
    timestamp: number;
    count: number;
  };

  // check interval; if greater than set interval ignore count and reset
  if (Date.now() - timestamp > apiLimits.interval) {
    // if
    await uidRef.set({
      timestamp: admin.database.ServerValue.TIMESTAMP,
      count: 1,
    });
  } else {
    if (count > apiLimits.count) {
      const error = new Error("too many calls");
      // @ts-expect-error || set custom to set retry-after header
      error.retryAfter =
        ~~((apiLimits.interval - (Date.now() - timestamp)) / 1000) + 1;
    } else {
      await uidRef.set({
        timestamp,
        count: admin.database.ServerValue.increment(1),
      });
      return;
    }
  }
};
