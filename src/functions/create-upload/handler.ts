import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

import {
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  getSignedUrl,
} from "@aws-sdk/s3-request-presigner";

import {
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";

import {
  DynamoDBDocumentClient,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

import crypto from "crypto";
import { logInfo } from "./logger";

const s3Client = new S3Client({});

const dynamoDBClient = new DynamoDBClient({});
const documentClient = DynamoDBDocumentClient.from(dynamoDBClient);

const IMAGES_BUCKET = process.env.IMAGES_BUCKET;
const IMAGES_TABLE = process.env.IMAGES_TABLE;

// if (!IMAGES_TABLE) {
//   throw new Error(
//     "IMAGES_TABLE environment variable is not configured"
//   );
// }

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

interface CreateUploadRequest {
  fileName: string;
  contentType: string;
}

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {

  const requestId = context.awsRequestId;

  logInfo("Create upload request received", {
    service: "create-upload",
    requestId
  });

  const userId =
  getAuthenticatedUserId(event);

  if (!userId) {
    return response(401, {
      message: "Unauthorized",
    });
  }

  logInfo("Authenticated upload request", {
    service: "create-upload",
    requestId,
    userId
  });

  try {

    if (!event.body) {
      return response(400, {
        message: "Request body is required",
      });
    }

    const body: CreateUploadRequest =
      JSON.parse(event.body);

    if (!body.fileName || !body.contentType) {
      return response(400, {
        message: "fileName and contentType are required",
      });
    }

    if (!ALLOWED_CONTENT_TYPES.includes(body.contentType)) {
      return response(400, {
        message: "Unsupported image type",
      });
    }

    if (!IMAGES_BUCKET) {
      throw new Error(
        "IMAGES_BUCKET environment variable is not configured"
      );
    }

    const imageId = crypto.randomUUID();

    const extension =
      getExtensionForContentType(body.contentType);

    const objectKey =
      `uploads/${imageId}.${extension}`;

    const now = new Date().toISOString();

    logInfo("Image record initialized", {
      service: "create-upload",
      requestId,
      imageId,
      userId,
      objectKey,
      contentType: body.contentType
    });


    const command = new PutObjectCommand({
      Bucket: IMAGES_BUCKET,
      Key: objectKey,
      ContentType: body.contentType,
    });

    const expiresIn = 300;

    const uploadUrl = await getSignedUrl(
      s3Client,
      command,
      {
        expiresIn,
      }
    );

    const imageRecord = {
        imageId,
        userId,

        originalFileName: body.fileName,
        contentType: body.contentType,
        objectKey,

        status: "PENDING_UPLOAD",

        createdAt: now,
        updatedAt: now,
    };

    await documentClient.send(
      new PutCommand({
        TableName: IMAGES_TABLE,

        Item: imageRecord,

        ConditionExpression:
          "attribute_not_exists(imageId)",
      })
    );

    logInfo("Image metadata stored", {
      service: "create-upload",
      requestId,
      imageId,
      status: "PENDING_UPLOAD"
    });

    return response(201, {
      imageId,
      uploadUrl,
      expiresIn
    });

  } catch (error) {

    console.error(
      "Failed to create upload URL:",
      error
    );

    return response(500, {
      message: "Unable to create upload URL",
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
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
};

export function getExtensionForContentType(
  contentType: string
): string {

  switch (contentType) {

    case "image/jpeg":
      return "jpg";

    case "image/png":
      return "png";

    case "image/webp":
      return "webp";

    default:
      throw new Error(
        "Unsupported content type"
      );
  }
};

export function getAuthenticatedUserId(
  event: APIGatewayProxyEvent
): string | undefined {

  const claims = event.requestContext.authorizer?.claims as
      | Record<string, string>
      | undefined;

  return claims?.sub;
};

export function isAllowedContentType(
  contentType: string
): boolean {
  return ALLOWED_CONTENT_TYPES.includes(
    contentType
  );
}