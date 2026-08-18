import pytest

from io import BytesIO

from PIL import Image
from app import (
    transform_image,
)

from app import (
    get_image_id_from_object_key,
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