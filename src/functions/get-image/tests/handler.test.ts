import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ownsImage,
  getXrayTraceId
} from "../handler";


describe(
  "ownsImage",
  () => {

    it(
      "allows the resource owner",
      () => {

        const image = {
          imageId: "image-1",
          userId: "user-1",
        };


        expect(
          ownsImage(
            image,
            "user-1"
          )
        ).toBe(true);
      }
    );


    it(
      "rejects another user",
      () => {

        const image = {
          imageId: "image-1",
          userId: "user-1",
        };


        expect(
          ownsImage(
            image,
            "user-2"
          )
        ).toBe(false);
      }
    );
  }
);

describe("getXrayTraceId", () => {
  it("extracts the Root trace ID", () => {
    process.env._X_AMZN_TRACE_ID =
      "Root=1-abc123-def456;Parent=1234567890abcdef;Sampled=1";

    expect(getXrayTraceId()).toBe("1-abc123-def456");
  });

  it("returns undefined when trace context is absent", () => {
    delete process.env._X_AMZN_TRACE_ID;

    expect(getXrayTraceId()).toBeUndefined();
  });
});