#!/usr/bin/env bash

set -euo pipefail

echo "============================================"
echo "Secure Image API - E2E Integration Tests"
echo "============================================"

required_vars=(
  "API_URL"
  "USER_POOL_CLIENT_ID"
  "AWS_REGION"
  "TEST_USERNAME_1"
  "TEST_PASSWORD_1"
  "TEST_USERNAME_2"
  "TEST_PASSWORD_2"
)

for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "::error::$var is required"
    exit 1
  fi
done

API_URL="${API_URL%/}"

TEMP_DIR=$(mktemp -d)

cleanup() {
  rm -rf "$TEMP_DIR"
}

trap cleanup EXIT

echo "API URL: $API_URL"
echo "Region: $AWS_REGION"


# ============================================================
# Helper: authenticate Cognito user
# ============================================================

authenticate_user() {
  local username="$1"
  local password="$2"

  local auth_response

  auth_response=$(aws cognito-idp initiate-auth \
    --region "$AWS_REGION" \
    --auth-flow USER_PASSWORD_AUTH \
    --client-id "$USER_POOL_CLIENT_ID" \
    --auth-parameters \
      "USERNAME=$username,PASSWORD=$password")

  local id_token

  id_token=$(echo "$auth_response" |
    jq -r '.AuthenticationResult.IdToken')

  if [[ -z "$id_token" || "$id_token" == "null" ]]; then
    echo "::error::Authentication failed for integration user" >&2
    return 1
  fi

  echo "$id_token"
}


# ============================================================
# Test 1
# Unauthenticated API access must fail
# ============================================================

echo
echo "Test 1: unauthenticated POST /images should return 401"

HTTP_STATUS=$(curl \
  --silent \
  --output "$TEMP_DIR/unauthenticated.json" \
  --write-out "%{http_code}" \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{"contentType":"image/png"}' \
  "$API_URL/images")

if [[ "$HTTP_STATUS" != "401" ]]; then
  echo "::error::Expected HTTP 401, received HTTP $HTTP_STATUS"
  cat "$TEMP_DIR/unauthenticated.json"
  exit 1
fi

echo "PASS: unauthenticated request returned 401"


# ============================================================
# Test 2
# Authenticate User 1
# ============================================================

echo
echo "Test 2: authenticate User 1"

USER_1_TOKEN=$(authenticate_user \
  "$TEST_USERNAME_1" \
  "$TEST_PASSWORD_1")

echo "PASS: User 1 authenticated"


# ============================================================
# Test 3
# Create image upload
# ============================================================

echo
echo "Test 3: create image upload"

HTTP_STATUS=$(curl \
  --silent \
  --output "$TEMP_DIR/create-image.json" \
  --write-out "%{http_code}" \
  --request POST \
  --header "Authorization: Bearer $USER_1_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"contentType":"image/png"}' \
  "$API_URL/images")

if [[ "$HTTP_STATUS" != "200" && "$HTTP_STATUS" != "201" ]]; then
  echo "::error::Expected HTTP 200/201, received HTTP $HTTP_STATUS"
  cat "$TEMP_DIR/create-image.json"
  exit 1
fi

IMAGE_ID=$(jq -r '.imageId' "$TEMP_DIR/create-image.json")
UPLOAD_URL=$(jq -r '.uploadUrl' "$TEMP_DIR/create-image.json")

if [[ -z "$IMAGE_ID" || "$IMAGE_ID" == "null" ]]; then
  echo "::error::POST /images did not return imageId"
  cat "$TEMP_DIR/create-image.json"
  exit 1
fi

if [[ -z "$UPLOAD_URL" || "$UPLOAD_URL" == "null" ]]; then
  echo "::error::POST /images did not return uploadUrl"
  cat "$TEMP_DIR/create-image.json"
  exit 1
fi

echo "PASS: image upload initialized"
echo "Image ID: $IMAGE_ID"


# ============================================================
# Test 4
# Generate a real PNG test image
# ============================================================

echo
echo "Test 4: generate PNG test image"

python3 - "$TEMP_DIR/test-image.png" <<'PY'
import base64
import sys

output_path = sys.argv[1]

png = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC"
    "AAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)

with open(output_path, "wb") as f:
    f.write(png)
PY

if [[ ! -s "$TEMP_DIR/test-image.png" ]]; then
  echo "::error::Failed to generate test PNG"
  exit 1
fi

echo "PASS: PNG generated"


# ============================================================
# Test 5
# Upload image using presigned S3 URL
# ============================================================

echo
echo "Test 5: upload image using presigned S3 URL"

UPLOAD_HTTP_STATUS=$(curl \
  --silent \
  --output "$TEMP_DIR/upload-response.txt" \
  --write-out "%{http_code}" \
  --request PUT \
  --header "Content-Type: image/png" \
  --upload-file "$TEMP_DIR/test-image.png" \
  "$UPLOAD_URL")

if [[ "$UPLOAD_HTTP_STATUS" != "200" ]]; then
  echo "::error::Expected S3 upload HTTP 200, received HTTP $UPLOAD_HTTP_STATUS"

  if [[ -s "$TEMP_DIR/upload-response.txt" ]]; then
    cat "$TEMP_DIR/upload-response.txt"
  fi

  exit 1
fi

echo "PASS: image uploaded to S3"


# ============================================================
# Test 6
# Poll until asynchronous processing finishes
# ============================================================

echo
echo "Test 6: wait for asynchronous image processing"

MAX_ATTEMPTS=30
SLEEP_SECONDS=5
ATTEMPT=1
FINAL_STATUS=""

while [[ "$ATTEMPT" -le "$MAX_ATTEMPTS" ]]; do

  HTTP_STATUS=$(curl \
    --silent \
    --output "$TEMP_DIR/get-image.json" \
    --write-out "%{http_code}" \
    --request GET \
    --header "Authorization: Bearer $USER_1_TOKEN" \
    "$API_URL/images/$IMAGE_ID")

  if [[ "$HTTP_STATUS" != "200" ]]; then
    echo "::error::GET /images/$IMAGE_ID returned HTTP $HTTP_STATUS"
    cat "$TEMP_DIR/get-image.json"
    exit 1
  fi

  # Supports either:
  # { "status": "PROCESSED" }
  #
  # or wrapped responses such as:
  # { "image": { "status": "PROCESSED" } }

  CURRENT_STATUS=$(jq -r '
    .status //
    .image.status //
    .item.status //
    empty
  ' "$TEMP_DIR/get-image.json")

  echo "Attempt $ATTEMPT/$MAX_ATTEMPTS: status=$CURRENT_STATUS"

  if [[ "$CURRENT_STATUS" == "PROCESSED" ]]; then
    FINAL_STATUS="$CURRENT_STATUS"
    break
  fi

  if [[ "$CURRENT_STATUS" == "FAILED" ]]; then
    echo "::error::Image processing entered FAILED state"
    cat "$TEMP_DIR/get-image.json"
    exit 1
  fi

  sleep "$SLEEP_SECONDS"

  ATTEMPT=$((ATTEMPT + 1))
done

if [[ "$FINAL_STATUS" != "PROCESSED" ]]; then
  echo "::error::Image did not reach PROCESSED within timeout"
  cat "$TEMP_DIR/get-image.json"
  exit 1
fi

echo "PASS: image reached PROCESSED state"


# ============================================================
# Test 7
# Verify processed image metadata
# ============================================================

echo
echo "Test 7: verify processed image metadata"

PROCESSED_KEY=$(jq -r '
  .processedKey //
  .image.processedKey //
  .item.processedKey //
  empty
' "$TEMP_DIR/get-image.json")

PROCESSED_CONTENT_TYPE=$(jq -r '
  .processedContentType //
  .image.processedContentType //
  .item.processedContentType //
  empty
' "$TEMP_DIR/get-image.json")

if [[ -z "$PROCESSED_KEY" ]]; then
  echo "::error::processedKey is missing from completed image"
  cat "$TEMP_DIR/get-image.json"
  exit 1
fi

if [[ "$PROCESSED_CONTENT_TYPE" != "image/jpeg" ]]; then
  echo "::error::Expected processedContentType=image/jpeg"
  echo "Actual: $PROCESSED_CONTENT_TYPE"
  exit 1
fi

echo "PASS: processed image metadata is present"


# ============================================================
# Test 8
# Authenticate User 2
# ============================================================

echo
echo "Test 8: authenticate User 2"

USER_2_TOKEN=$(authenticate_user \
  "$TEST_USERNAME_2" \
  "$TEST_PASSWORD_2")

echo "PASS: User 2 authenticated"


# ============================================================
# Test 9
# Cross-user ownership must be denied
# ============================================================

echo
echo "Test 9: User 2 should receive 403 for User 1 image"

HTTP_STATUS=$(curl \
  --silent \
  --output "$TEMP_DIR/cross-user.json" \
  --write-out "%{http_code}" \
  --request GET \
  --header "Authorization: Bearer $USER_2_TOKEN" \
  "$API_URL/images/$IMAGE_ID")

if [[ "$HTTP_STATUS" != "403" ]]; then
  echo "::error::Expected HTTP 403 for cross-user access, received HTTP $HTTP_STATUS"
  cat "$TEMP_DIR/cross-user.json"
  exit 1
fi

echo "PASS: cross-user access correctly returned 403"


# ============================================================
# Test 10
# Owner can still retrieve processed image
# ============================================================

echo
echo "Test 10: User 1 can retrieve own processed image"

HTTP_STATUS=$(curl \
  --silent \
  --output "$TEMP_DIR/final-owner-get.json" \
  --write-out "%{http_code}" \
  --request GET \
  --header "Authorization: Bearer $USER_1_TOKEN" \
  "$API_URL/images/$IMAGE_ID")

if [[ "$HTTP_STATUS" != "200" ]]; then
  echo "::error::Expected HTTP 200 for owner access, received HTTP $HTTP_STATUS"
  cat "$TEMP_DIR/final-owner-get.json"
  exit 1
fi

FINAL_STATUS=$(jq -r '
  .status //
  .image.status //
  .item.status //
  empty
' "$TEMP_DIR/final-owner-get.json")

if [[ "$FINAL_STATUS" != "PROCESSED" ]]; then
  echo "::error::Expected final status PROCESSED"
  echo "Actual: $FINAL_STATUS"
  exit 1
fi

echo "PASS: owner access returned processed image"


echo
echo "============================================"
echo "ALL END-TO-END INTEGRATION TESTS PASSED"
echo "============================================"
echo
echo "Validated:"
echo "  - Cognito authentication"
echo "  - API Gateway authorization"
echo "  - POST /images"
echo "  - S3 presigned upload"
echo "  - S3 event notification"
echo "  - ProcessImage Lambda"
echo "  - Pillow image processing"
echo "  - DynamoDB state updates"
echo "  - GET /images/{imageId}"
echo "  - resource ownership enforcement"