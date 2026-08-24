import pytest

from io import BytesIO

from PIL import Image
from app import (
    transform_image,
)

from app import (
    get_image_id_from_object_key,
    build_processing_failure_metric,
)


def test_extracts_image_id_from_jpeg():
    result = (
        get_image_id_from_object_key(
            "uploads/abc-123.jpg"
        )
    )

    assert result == "abc-123"


def test_extracts_image_id_from_png():
    result = (
        get_image_id_from_object_key(
            "uploads/abc-456.png"
        )
    )

    assert result == "abc-456"


def test_rejects_missing_extension():
    with pytest.raises(
        ValueError
    ):
        get_image_id_from_object_key(
            "uploads/abc-123"
        )



def create_test_image(
    width=2000,
    height=1000,
    image_format="JPEG",
):

    image = Image.new(
        "RGB",
        (
            width,
            height,
        ),
    )

    buffer = BytesIO()

    image.save(
        buffer,
        format=image_format,
    )

    return buffer.getvalue()

def test_resizes_large_image():

    source = create_test_image(
        width=2400,
        height=1200,
    )


    result = transform_image(
        source
    )


    assert (
        result[
            "processed_width"
        ]
        == 1200
    )

    assert (
        result[
            "processed_height"
        ]
        == 600
    )

    assert (
        result[
            "detected_format"
        ]
        == "JPEG"
    )

def test_transform_image_returns_processed_bytes():
    image_bytes = create_test_image(100, 100)

    result = transform_image(image_bytes)

    assert result["bytes"]
    assert isinstance(result["bytes"], bytes)

def test_does_not_enlarge_small_image():

    source = create_test_image(
        width=600,
        height=400,
    )


    result = transform_image(
        source
    )


    assert (
        result[
            "processed_width"
        ]
        == 600
    )

    assert (
        result[
            "processed_height"
        ]
        == 400
    )

def test_rejects_fake_image():

    fake_image = (
        b"This is not actually an image"
    )


    with pytest.raises(
        Exception
    ):
        transform_image(
            fake_image
        )

def test_build_processing_failure_metric():
    metric = build_processing_failure_metric(
        image_id="test-image-id",
        request_id="test-request-id",
        error_type="ValueError"
    )

    assert metric["Service"] == "process-image"
    assert metric["ImageProcessingFailures"] == 1

    cloudwatch = metric["_aws"]["CloudWatchMetrics"][0]

    assert cloudwatch["Namespace"] == "SecureImageApi"
    assert cloudwatch["Dimensions"] == [["Service"]]

    definition = cloudwatch["Metrics"][0]

    assert definition["Name"] == "ImageProcessingFailures"
    assert definition["Unit"] == "Count"

def test_failure_metric_does_not_use_high_cardinality_dimensions():
    metric = build_processing_failure_metric(
        image_id="image-123",
        request_id="request-456",
        error_type="ValueError"
    )

    dimensions = (
        metric["_aws"]["CloudWatchMetrics"][0]["Dimensions"]
    )

    assert dimensions == [["Service"]]

    flattened_dimensions = {
        dimension
        for dimension_set in dimensions
        for dimension in dimension_set
    }

    assert "imageId" not in flattened_dimensions
    assert "requestId" not in flattened_dimensions

