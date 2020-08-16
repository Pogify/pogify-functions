export function validateBody(body: { [key: string]: any }) {
  let valid = [body.timestamp, body.uri, body.position, body.playing].every(
    Boolean
  );

  if (valid) {
    return Promise.resolve();
  } else {
    return Promise.reject("improper body");
  }
}
