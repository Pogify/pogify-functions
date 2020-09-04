export function validateBody(body: { [key: string]: any }) {
  const errArr = [];

  const { timestamp, uri, position, playing, track_window } = body;

  if (timestamp === undefined) {
    errArr.push("missing timestamp");
  } else if (typeof timestamp !== "number") {
    errArr.push("timestamp is not a number");
  } else if (timestamp < 157762700400) {
    errArr.push("timestamp not in milliseconds");
  }

  if (uri === undefined) {
    errArr.push("missing uri");
  } else if (typeof uri !== "string") {
    errArr.push("uri is not string");
  } else if (uri === "") {
    // do nothing if its an empty string
    // empty string indicates disconnected host
  } else if (!uri.startsWith("spotify:")) {
    errArr.push("improper uri format");
  }

  if (track_window === undefined) {
    //tslint: disable-line
    // errArr.push("missing track_window");
  } else if (!(track_window instanceof Array)) {
    errArr.push("track_window is not an array");
  } else if (!track_window.length) {
    errArr.push("track_window has no elements");
  } else if (
    track_window.reduce((acc, cur) => {
      return !cur.startsWith("spotify:") || acc;
    }, false)
  ) {
    errArr.push("malformed track_window elements");
  }

  if (position === undefined) {
    errArr.push("missing position");
  } else if (typeof position !== "number") {
    errArr.push("position is not a number");
  }

  if (playing === undefined) {
    errArr.push("missing playing state");
  } else if (typeof playing !== "boolean") {
    errArr.push("playing is not a boolean");
  }

  if (errArr.length) {
    throw errArr.join("; ");
  }
  return {
    timestamp,
    uri,
    position,
    track_window,
    playing,
  };
}
