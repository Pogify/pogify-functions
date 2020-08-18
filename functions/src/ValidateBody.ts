export function validateBody(body: { [key: string]: any }) {
  const errArr = [];

  const { timestamp, uri, position, playing } = body;

  if (!timestamp) {
    errArr.push("missing timestamp");
  } else if (typeof timestamp !== "number") {
    errArr.push("timestamp is not a number");
  } else if (timestamp < 1597625975267) {
    errArr.push("timestamp not in milliseconds");
  }

  if (!uri) {
    errArr.push("missing uri");
  } else if (typeof uri !== "string") {
    errArr.push("uri is not string");
  } else if (!uri.startsWith("spotify:track:")) {
    errArr.push("improper uri format");
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
    playing,
  };
}
