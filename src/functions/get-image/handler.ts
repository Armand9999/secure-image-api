import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

import {
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";

import {
  DynamoDBDocumentClient,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { logInfo, logWarn } from "./logger";


const dynamoClient =
  new DynamoDBClient({});

const documentClient =
  DynamoDBDocumentClient.from(
    dynamoClient
  );

const IMAGES_TABLE = process.env.IMAGES_TABLE;

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {

  const requestId = context.awsRequestId;

  const userId = getAuthenticatedUserId(event);

  if (!userId) {
    return response(401, {
      message: "Unauthorized",
    });
  }

  try {

    if (!IMAGES_TABLE) {
      throw new Error(
        "IMAGES_TABLE environment variable is not configured"
      );
    }

    const imageId =
      event.pathParameters?.imageId;

    if (!imageId) {
      return response(400, {
        message: "imageId is required",
      });
    }

    const result =
      await documentClient.send(
        new GetCommand({
          TableName: IMAGES_TABLE,

          Key: {
            imageId,
          },
        })
      );
    
    const traceId = getXrayTraceId();

    logInfo("Get image request received", {
      service: "get-image",
      requestId,
      imageId,
      traceId
    });

    if (!result.Item) {
      logWarn("Image not found", {
        service: "get-image",
        requestId: context.awsRequestId,
        imageId
      });

      return response(404, {
        message: "Image not found",
      });
    }

    if (!ownsImage(result.Item, userId)) {
      logWarn("Image access denied", {
        service: "get-image",
        requestId: context.awsRequestId,
        imageId,
        reason: "ownership_mismatch"
      });
      return response(403, {
        message:
          "You are not authorized to access this image",
      });
    }

    logInfo("Image retrieved", {
      service: "get-image",
      requestId: context.awsRequestId,
      imageId,
      status: result.Item.status
    });

    return response(200, {
      image: result.Item,
    });

  } catch (error) {

    console.error(
      "Failed to retrieve image:",
      error
    );

    return response(500, {
      message:
        "Unable to retrieve image",
    });
  }
};

function response(
  statusCode: number,
  body: unknown
): APIGatewayProxyResult {

  return {
    statusCode,

    headers: {
      "Content-Type":
        "application/json",
    },

    body:
      JSON.stringify(body),
  };
};

function getAuthenticatedUserId(
  event: APIGatewayProxyEvent
): string | undefined {

  const claims = event.requestContext.authorizer?.claims as
      | Record<string, string>
      | undefined;

  return claims?.sub;
};

export function ownsImage(
  image:
    Record<string, unknown>,
  userId: string
): boolean {

  return (
    image.userId === userId
  );
}

export function getXrayTraceId(): string | undefined {
  const traceHeader = process.env._X_AMZN_TRACE_ID;

  if (!traceHeader) {
    return undefined;
  }

  const root = traceHeader
    .split(";")
    .find(part => part.startsWith("Root="));

  return root?.substring("Root=".length);
}