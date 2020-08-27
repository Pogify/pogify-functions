import { validateBody } from "./ValidateBody";

describe("testing for body validation", () => {
  let invalidBody: object = {};
  let errorMessage: string = "";

  const createErrorMessage = (errorList: string[]) => {
    return errorList.join("; ");
  };
  
  test("should throw error if body content is missing", () => {
    errorMessage = createErrorMessage([
      "missing timestamp",
      "missing uri",
      "missing position",
      "missing playing state"
    ]);
    
    expect(() => { validateBody(invalidBody); }).toThrow(errorMessage);
  })

  test("should throw error if body has incorrect types", () => {
    invalidBody = {
      timestamp: "not a number",
      uri: 1000,
      position: "not a number",
      playing: "not a boolean"
    };

    errorMessage = createErrorMessage([
      "timestamp is not a number",
      "uri is not string",
      "position is not a number",
      "playing is not a boolean"
    ]);

    expect(() => { validateBody(invalidBody); }).toThrow(errorMessage);
  })

  test("should throw error if timestamp is 0", () => {
    expect.assertions(2);
    
    invalidBody = {
      timestamp: 0,
      uri: "spotify:track:6sFIWsNpZYqfjUpaCgueju",
      position: 0,
      playing: true,
    };

    expect(() => { validateBody(invalidBody); }).toThrow("timestamp not in milliseconds");
  });
})