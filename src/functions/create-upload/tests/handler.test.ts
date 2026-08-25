import {
  describe,
  expect,
  it,
} from "vitest";

import {
  isAllowedContentType, getExtensionForContentType, getAuthenticatedUserId, getXrayTraceId
} from "../handler";

import type {
  APIGatewayProxyEvent,
} from "aws-lambda";

describe(
  "isAllowedContentType",
  () => {

    it(
      "accepts JPEG",
      () => {
        expect(
          isAllowedContentType(
            "image/jpeg"
          )
        ).toBe(true);
      }
    );


    it(
      "accepts PNG",
      () => {
        expect(
          isAllowedContentType(
            "image/png"
          )
        ).toBe(true);
      }
    );


    it(
      "accepts WebP",
      () => {
        expect(
          isAllowedContentType(
            "image/webp"
          )
        ).toBe(true);
      }
    );


    it(
      "rejects PDF",
      () => {
        expect(
          isAllowedContentType(
            "application/pdf"
          )
        ).toBe(false);
      }
    );
  }
);

describe(
  "getExtensionForContentType",
  () => {

    it(
      "maps JPEG to jpg",
      () => {
        expect(
          getExtensionForContentType(
            "image/jpeg"
          )
        ).toBe("jpg");
      }
    );


    it(
      "maps PNG to png",
      () => {
        expect(
          getExtensionForContentType(
            "image/png"
          )
        ).toBe("png");
      }
    );


    it(
      "maps WebP to webp",
      () => {
        expect(
          getExtensionForContentType(
            "image/webp"
          )
        ).toBe("webp");
      }
    );


    it(
      "rejects unsupported type",
      () => {
        expect(
          () =>
            getExtensionForContentType(
              "application/pdf"
            )
        ).toThrow();
      }
    );
  }
);

describe(
  "getAuthenticatedUserId",
  () => {

    it(
      "extracts Cognito sub",
      () => {

        const event = {
          requestContext: {
            authorizer: {
              claims: {
                sub: "user-123",
              },
            },
          },
        } as unknown as
          APIGatewayProxyEvent;


        expect(
          getAuthenticatedUserId(
            event
          )
        ).toBe(
          "user-123"
        );
      }
    );


    it(
      "returns undefined when claims are absent",
      () => {

        const event = {
          requestContext: {},
        } as unknown as
          APIGatewayProxyEvent;


        expect(
          getAuthenticatedUserId(
            event
          )
        ).toBeUndefined();
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