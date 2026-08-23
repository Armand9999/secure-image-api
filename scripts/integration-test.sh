#!/usr/bin/env bash

set -euo pipefail

echo "============================================"
echo "Secure Image API - Integration Tests"
echo "============================================"

required_vars=(
  "API_URL"
  "USER_POOL_CLIENT_ID"
  "AWS_REGION"
  "TEST_USERNAME"
  "TEST_PASSWORD"
)

for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "::error::$var is required"
    exit 1
  fi
done

API_URL="${API_URL%/}"

echo "API URL: $API_URL"
echo "Region: $AWS_REGION"

# ------------------------------------------------------------
# Test 1: unauthenticated request must be rejected
# ------------------------------------------------------------

echo
echo "Test 1: unauthenticated POST should return 401"

HTTP_STATUS=$(curl \
  --silent \
  --output /tmp/unauthenticated-response.json \
  --write-out "%{http_code}" \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{"contentType":"image/jpeg"}' \
  "$API_URL/images")

if [[ "$HTTP_STATUS" != "401" ]]; then
  echo "::error::Expected HTTP 401, received HTTP $HTTP_STATUS"
  cat /tmp/unauthenticated-response.json
  exit 1
fi

echo "PASS: unauthenticated request returned 401"


# ------------------------------------------------------------
# Test 2: authenticate against Cognito
# ------------------------------------------------------------

echo
echo "Test 2: authenticate integration user"

AUTH_RESPONSE=$(aws cognito-idp initiate-auth \
  --region "$AWS_REGION" \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$USER_POOL_CLIENT_ID" \
  --auth-parameters \
    "USERNAME=$TEST_USERNAME,PASSWORD=$TEST_PASSWORD")

ID_TOKEN=$(echo "$AUTH_RESPONSE" | jq -r '.AuthenticationResult.IdToken')

if [[ -z "$ID_TOKEN" || "$ID_TOKEN" == "null" ]]; then
  echo "::error::Cognito authentication did not return an ID token"
  exit 1
fi

echo "PASS: Cognito authentication succeeded"


# ------------------------------------------------------------
# Test 3: authenticated POST /images
# ------------------------------------------------------------

echo
echo "Test 3: authenticated POST /images"

HTTP_STATUS=$(curl \
  --silent \
  --output /tmp/create-image-response.json \
  --write-out "%{http_code}" \
  --request POST \
  --header "Authorization: Bearer $ID_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"contentType":"image/jpeg"}' \
  "$API_URL/images")

if [[ "$HTTP_STATUS" != "200" && "$HTTP_STATUS" != "201" ]]; then
  echo "::error::Expected HTTP 200/201, received HTTP $HTTP_STATUS"
  cat /tmp/create-image-response.json
  exit 1
fi

IMAGE_ID=$(jq -r '.imageId' /tmp/create-image-response.json)
UPLOAD_URL=$(jq -r '.uploadUrl' /tmp/create-image-response.json)

if [[ -z "$IMAGE_ID" || "$IMAGE_ID" == "null" ]]; then
  echo "::error::POST /images did not return imageId"
  cat /tmp/create-image-response.json
  exit 1
fi

if [[ -z "$UPLOAD_URL" || "$UPLOAD_URL" == "null" ]]; then
  echo "::error::POST /images did not return uploadUrl"
  cat /tmp/create-image-response.json
  exit 1
fi

echo "PASS: authenticated image creation succeeded"
echo "Image ID: $IMAGE_ID"


echo
echo "============================================"
echo "Integration smoke tests passed"
echo "============================================"