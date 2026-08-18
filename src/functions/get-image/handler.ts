import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";

import {
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";

import {
  DynamoDBDocumentClient,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";


const dynamoClient =
  new DynamoDBClient({});

const documentClient =
  DynamoDBDocumentClient.from(
    dynamoClient
  );

const IMAGES_TABLE = process.env.IMAGES_TABLE;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

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

    if (!result.Item) {
      return response(404, {
        message: "Image not found",
      });
    }

    if (!ownsImage(result.Item, userId)) {
      return response(403, {
        message:
          "You are not authorized to access this image",
      });
    }

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