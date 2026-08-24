import io
import os
import urllib.parse

from datetime import datetime, timezone

import boto3

from PIL import Image, ImageOps

import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)


s3 = boto3.client("s3")

dynamodb = boto3.resource(
    "dynamodb"
)


IMAGES_TABLE = os.getenv("IMAGES_TABLE")

images_table = dynamodb.Table(
    IMAGES_TABLE
)


MAX_FILE_SIZE = (
    10 * 1024 * 1024
)

MAX_WIDTH = 10_000
MAX_HEIGHT = 10_000

OUTPUT_MAX_WIDTH = 1200
OUTPUT_MAX_HEIGHT = 1200


SUPPORTED_FORMATS = {
    "JPEG",
    "PNG",
    "WEBP",
}


def lambda_handler(event, context):
    request_id = context.aws_request_id
    records = event.get(
        "Records",
        []
    )

    print(
        f"Received {len(records)} S3 record(s)"
    )

    for record in records:
        process_record(record)


def process_record(record):
    bucket_name = (
        record["s3"]
        ["bucket"]
        ["name"]
    )

    object_key = (
        urllib.parse.unquote_plus(
            record["s3"]
            ["object"]
            ["key"]
        )
    )

    object_size = (
        record["s3"]
        ["object"]
        .get("size", 0)
    )

    image_id = (
        get_image_id_from_object_key(
            object_key
        )
    )


    logger.info(
        "Image processing started",
        extra={
            "service": "process-image",
            "requestId": request_id,
            "imageId": image_id,
            "bucketName": bucket_name,
            "objectKey": object_key,
            "stage": "processing"
        }
    )


    try:

        update_status(
            image_id,
            "PROCESSING"
        )


        if (
            object_size >
            MAX_FILE_SIZE
        ):
            raise ValueError(
                "Uploaded image exceeds "
                "maximum allowed size"
            )


        response = s3.get_object(
            Bucket=bucket_name,
            Key=object_key,
        )


        image_bytes = (
            response["Body"].read()
        )

        logger.info(
            "Source image downloaded",
            extra={
                "service": "process-image",
                "requestId": request_id,
                "imageId": image_id,
                "fileSize": len(image_bytes)
            }
        )


        
        processed_image = transform_image(image_bytes)


        processed_key = (
            f"processed/"
            f"{image_id}.jpg"
        )


        s3.put_object(
            Bucket=bucket_name,
            Key=processed_key,
            Body=processed_image["bytes"],
            ContentType="image/jpeg",
        )

        logger.info(
            "Processed image uploaded",
            extra={
                "service": "process-image",
                "requestId": request_id,
                "imageId": image_id,
                "processedKey": processed_key,
                "processedFileSize": len(transformed["bytes"])
            }
        )

        save_processed_metadata(
            image_id=image_id,

            detected_format=
                processed_image["detected_format"],

            original_width=
                processed_image["original_width"],

            original_height=
                processed_image["original_height"],

            original_file_size=
                len(image_bytes),

            processed_key=
                processed_key,

            processed_file_size=
                len(processed_image["bytes"]),
        )


        logger.info(
            "Image processing completed",
            extra={
                "service": "process-image",
                "requestId": request_id,
                "imageId": image_id,
                "status": "PROCESSED"
            }
        )

        


    except Exception as exc:
        logger.exception(
            "Image processing failed",
            extra={
                "service": "process-image",
                "requestId": request_id,
                "imageId": image_id,
                "objectKey": object_key,
                "stage": "processing",
                "errorType": type(exc).__name__
            }
        )

        # Mark the image as failed without masking the original exception.
        try:

            update_status(
                image_id,
                "FAILED"
            )

        except Exception as status_error:

            print(
                "Unable to mark image as FAILED",
                {
                    "imageId":
                        image_id,

                    "error":
                        str(
                            status_error
                        ),
                }
            )


        raise


def update_status(
    image_id,
    status,
):
    images_table.update_item(
        Key={
            "imageId":
                image_id
        },

        UpdateExpression=(
            "SET "
            "#status = :status, "
            "updatedAt = :updatedAt"
        ),

        ExpressionAttributeNames={
            "#status":
                "status"
        },

        ExpressionAttributeValues={
            ":status":
                status,

            ":updatedAt":
                current_timestamp(),
        },

        ConditionExpression=(
            "attribute_exists(imageId)"
        ),
    )


def save_processed_metadata(
    image_id,
    detected_format,
    original_width,
    original_height,
    original_file_size,
    processed_key,
    processed_file_size,
):

    images_table.update_item(
        Key={
            "imageId":
                image_id
        },

        UpdateExpression=(
            "SET "
            "#status = :status, "
            "updatedAt = :updatedAt, "
            "detectedFormat = :detectedFormat, "
            "originalWidth = :originalWidth, "
            "originalHeight = :originalHeight, "
            "originalFileSize = :originalFileSize, "
            "processedKey = :processedKey, "
            "processedContentType = :processedContentType, "
            "processedFileSize = :processedFileSize"
        ),

        ExpressionAttributeNames={
            "#status":
                "status"
        },

        ExpressionAttributeValues={
            ":status":
                "PROCESSED",

            ":updatedAt":
                current_timestamp(),

            ":detectedFormat":
                detected_format,

            ":originalWidth":
                original_width,

            ":originalHeight":
                original_height,

            ":originalFileSize":
                original_file_size,

            ":processedKey":
                processed_key,

            ":processedContentType":
                "image/jpeg",

            ":processedFileSize":
                processed_file_size,
        },

        ConditionExpression=(
            "attribute_exists(imageId)"
        ),
    )


def get_image_id_from_object_key(
    object_key,
):

    file_name = (
        object_key
        .rsplit("/", 1)[-1]
    )


    if "." not in file_name:
        raise ValueError(
            f"Invalid image filename: "
            f"{file_name}"
        )


    image_id = (
        file_name
        .rsplit(".", 1)[0]
    )


    if not image_id:
        raise ValueError(
            "Unable to determine "
            f"imageId from: {object_key}"
        )


    return image_id


def current_timestamp():
    return datetime.now(
        timezone.utc
    ).isoformat()


def transform_image(
    image_bytes
):

    if (
        len(image_bytes)
        > MAX_FILE_SIZE
    ):
        raise ValueError(
            "Image exceeds maximum allowed size"
        )


    source_buffer = io.BytesIO(
        image_bytes
    )


    image = Image.open(
        source_buffer
    )


    image.load()


    detected_format = (
        image.format
    )


    if (
        detected_format
        not in SUPPORTED_FORMATS
    ):
        raise ValueError(
            "Unsupported image format"
        )


    (
        original_width,
        original_height,
    ) = image.size


    if (
        original_width >
        MAX_WIDTH
        or
        original_height >
        MAX_HEIGHT
    ):
        raise ValueError(
            "Image dimensions exceed allowed limits"
        )


    image = (
        ImageOps.exif_transpose(
            image
        )
    )


    if image.mode != "RGB":
        image = image.convert(
            "RGB"
        )


    image.thumbnail(
        (
            OUTPUT_MAX_WIDTH,
            OUTPUT_MAX_HEIGHT,
        ),
        Image.Resampling.LANCZOS,
    )


    output_buffer = (
        io.BytesIO()
    )


    image.save(
        output_buffer,
        format="JPEG",
        quality=82,
        optimize=True,
    )


    processed_bytes = (
        output_buffer.getvalue()
    )


    return {
        "bytes":
            processed_bytes,

        "detected_format":
            detected_format,

        "original_width":
            original_width,

        "original_height":
            original_height,

        "processed_width":
            image.width,

        "processed_height":
            image.height,
    }