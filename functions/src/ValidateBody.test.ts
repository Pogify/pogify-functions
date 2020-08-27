import { validateBody } from "./ValidateBody";

describe("testing for body validation", () => {
  // testing for negative results
  let invalidBody: { [key: string]: any };
  let errorMessage: string = "";
  
  test("should throw appropriate missing errors", () => {
    /*
      the body will never look like this,
      but validateBody is only ever used when the body isn't empty,
      so have to account for that by testing a non-empty object with relevant values missing;
      will run into destructuring issues if not
    */
    invalidBody = { missing: null}; 
    
    errorMessage = [
      "missing timestamp",
      "missing uri",
      "missing position",
      "missing playing state"
    ].join("; ");

    expect(() => { validateBody(invalidBody); }).toThrow(errorMessage);
  });

  test("should throw appropriate invalid type errors", () => {
    invalidBody = {
      timestamp: "not a number",
      uri: 1000,
      position: "not a number",
      playing: "not a boolean"
    };

    errorMessage = [
      "timestamp is not a number",
      "uri is not string",
      "position is not a number",
      "playing is not a boolean"
    ].join("; ");

    expect(() => { validateBody(invalidBody); }).toThrow(errorMessage);
  });

  test("should throw error if timestamp isn't in milliseconds", () => {
    invalidBody = {
      timestamp: 0,
      uri: "spotify:track:6sFIWsNpZYqfjUpaCgueju",
      position: 0,
      playing: true,
    };

    expect(() => { validateBody(invalidBody); }).toThrow("timestamp not in milliseconds");

    invalidBody.timestamp = 9000;

    expect(() => { validateBody(invalidBody); }).toThrow("timestamp not in milliseconds");
  });

  test("should throw error if improper uri format", () => {
    invalidBody = {
      timestamp: 2597625975267,
      uri: "invalid uri",
      position: 0,
      playing: true,
    };

    expect(() => { validateBody(invalidBody); }).toThrow("improper uri format");
  });

  // testing for positive results
  let validBody: { [key: string]: any };

  test("should return same values as body if disconnected host", () => {
    validBody = {
      timestamp: 2597625975267,
      uri: "",
      position: 0,
      playing: true,
    }

    const valided = validateBody(validBody);

    expect(valided.timestamp).toBe(validBody.timestamp);
    expect(valided.uri).toBe(validBody.uri);
    expect(valided.position).toBe(validBody.position);
    expect(valided.playing).toBe(validBody.playing);
  })

  test("should return same values as body if all values are valid", () => {
    validBody = {
      timestamp: 2597625975267,
      uri: "spotify:track:6sFIWsNpZYqfjUpaCgueju",
      position: 0,
      playing: true,
    }

    const valided = validateBody(validBody);

    expect(valided.timestamp).toBe(validBody.timestamp);
    expect(valided.uri).toBe(validBody.uri);
    expect(valided.position).toBe(validBody.position);
    expect(valided.playing).toBe(validBody.playing);
  })
})
