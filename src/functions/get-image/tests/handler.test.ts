import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ownsImage,
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