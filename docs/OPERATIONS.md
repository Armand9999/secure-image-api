# Secure Image API — Operational Runbook

## Purpose

This runbook provides diagnostic and recovery procedures for the Secure Image API dev environment.

The system consists of:

- Amazon API Gateway
- Amazon Cognito
- AWS Lambda
  - CreateUploadFunction
  - GetImageFunction
  - ProcessImageFunction
- Amazon S3
- Amazon DynamoDB
- Amazon CloudWatch
- Amazon SNS

## Primary Workflow

Client
→ POST /images
→ CreateUploadFunction
→ DynamoDB: PENDING_UPLOAD
→ Presigned S3 upload
→ S3 ObjectCreated event
→ ProcessImageFunction
→ DynamoDB: PROCESSING
→ processed/{imageId}.jpg
→ DynamoDB: PROCESSED
→ GET /images/{imageId}

## Expected Image States

PENDING_UPLOAD
→ PROCESSING
→ PROCESSED

Failure state:

PENDING_UPLOAD / PROCESSING
→ FAILED

## Operational Alarms

| Alarm | Signal | Meaning |
|---|---|---|
| process-image-errors | AWS/Lambda Errors | ProcessImageFunction invocation failed |
| process-image-throttles | AWS/Lambda Throttles | Processor invocation was rejected due to concurrency limits |
| api-5xx-errors | AWS/ApiGateway 5XXError | API clients received server-side failures |
| image-processing-failures | SecureImageApi/ImageProcessingFailures | Application recorded an image-processing failure |

## Incident: ProcessImageFunction Errors

### Alarm

`secure-image-api-dev-process-image-errors`

### Meaning

One or more ProcessImageFunction invocations failed during the alarm evaluation period.

### Initial Checks

1. Open the Secure Image API CloudWatch dashboard.
2. Check:
   - Processor Errors
   - ImageProcessingFailures
   - Processor Duration
   - Processor Throttles
3. Inspect recent ProcessImageFunction logs.
4. Identify the affected imageId.
5. Check the DynamoDB status for the image.
6. Check whether the corresponding source object exists in S3.

### Common Causes

- Invalid or unsupported image data
- S3 GetObject failure
- S3 PutObject failure
- DynamoDB UpdateItem failure
- Pillow decoding or transformation exception
- Lambda timeout
- Application regression

### Recent Processing Failures

```sql
fields @timestamp, level, message, imageId, requestId, errorType
| filter level = "ERROR"
| sort @timestamp desc
| limit 50```


For a specific image:


### Trace One Image

Replace `IMAGE_ID` with the affected image ID.

```sql
fields @timestamp, level, message, imageId, requestId, stage, status, errorType
| filter imageId = "IMAGE_ID"
| sort @timestamp asc```


For recent processing lifecycle events:

```sql
fields @timestamp, level, message, imageId, stage, status
| filter ispresent(imageId)
| sort @timestamp desc
| limit 100```

For access-denied events in GetImageFunction:
```sql
fields @timestamp, level, message, imageId, requestId, reason
| filter message = "Image access denied"
| sort @timestamp desc
| limit 50```

### Processor Failure Decision Tree

ProcessImageFunction Error
|
+-- errorType = AccessDenied / ClientError
|   |
|   +-- S3 GetObject
|   |   → Check uploads/* read permissions
|   |
|   +-- S3 PutObject
|   |   → Check processed/* write permissions
|   |
|   +-- DynamoDB
|       → Check UpdateItem permissions and table availability
|
+-- image decoding error
|   → Verify uploaded file is a valid JPEG, PNG, or WebP
|
+-- timeout
|   → Check Duration metric
|   → Inspect source file size and dimensions
|   → Verify Lambda timeout/memory settings
|
+-- application exception
    → Inspect errorType and traceback
    → Reproduce with unit test
    → Fix and deploy through CI/CD

## Incident: Image Processing Failure

### Alarm

`secure-image-api-dev-image-processing-failures`

### Meaning

The application emitted the `ImageProcessingFailures` metric because an image-processing workflow entered the FAILED path.

### Investigation

1. Open the Processor Errors graph.
2. Check whether AWS/Lambda Errors increased at the same time.
3. Query ProcessImageFunction logs for `level = ERROR`.
4. Identify the `imageId`.
5. Retrieve the corresponding DynamoDB item.
6. Verify its status is `FAILED`.
7. Verify the source S3 object still exists.
8. Review `errorType` in structured logs.

### Interpretation

If both:

- `ImageProcessingFailures > 0`
- `Lambda Errors > 0`

the processor executed but failed.

If:

- `Lambda Throttles > 0`
- `ImageProcessingFailures = 0`

the processor may not have started at all.


## Incident: ProcessImageFunction Throttling

### Alarm

`secure-image-api-dev-process-image-throttles`

### Meaning

Lambda rejected one or more ProcessImageFunction invocations because concurrency was unavailable.

### Investigation

1. Check Processor Throttles on the operational dashboard.
2. Compare against Processor Invocations.
3. Check ConcurrentExecutions in CloudWatch.
4. Determine whether multiple S3 uploads occurred simultaneously.
5. Check account-level Lambda concurrency.
6. Check whether reserved concurrency is configured for the function.

### Important

A throttle is different from a normal Lambda execution error.

The invocation may not have started, so there may be no application error log for that request.

### Possible Actions

- Allow asynchronous Lambda retries to proceed.
- Investigate sudden upload bursts.
- Review reserved concurrency.
- Review account concurrency limits.
- Increase concurrency only when justified by workload requirements.


## Incident: API Gateway 5XX Errors

### Alarm

`secure-image-api-dev-api-5xx-errors`

### Meaning

One or more API consumers received a server-side HTTP 5XX response.

### Investigation

1. Open the API 5XX graph.
2. Compare 5XX count with total API request count.
3. Determine which route was failing:
   - POST /images
   - GET /images/{imageId}
4. Inspect CreateUploadFunction and GetImageFunction logs.
5. Search by requestId where available.
6. Check Lambda Errors for the same time window.
7. Check DynamoDB and Cognito dependencies if relevant.

### Common Causes

POST /images:

- DynamoDB PutItem failure
- S3 presigned URL generation failure
- malformed application configuration
- unexpected Lambda exception

GET /images/{imageId}:

- DynamoDB GetItem failure
- unexpected Lambda exception
- application configuration failure

### Not Normally 5XX

- Missing JWT → 401
- Cross-user access → 403
- Invalid request payload → 400

Those are expected client/security responses and should not trigger the 5XX alarm.

## CLI Diagnostics

### Get Processor Function Name

*powershell*
$ProcessFunctionName` = `aws cloudformation describe-stack-resource \`
  --stack-name secure-image-api-dev \`
  --logical-resource-id ProcessImageFunction \`
  --query "StackResourceDetail.PhysicalResourceId" \`
  --output text 


# Phase 8.6.9 — Add DynamoDB diagnostics

Because DynamoDB represents the processing state machine, it is an important diagnostic source.

Add:

*markdown*
## DynamoDB Diagnostics

For an affected image, inspect:

- imageId
- status
- objectKey
- processedKey
- contentType
- processedContentType
- createdAt
- updatedAt

Expected successful lifecycle:

`PENDING_UPLOAD → PROCESSING → PROCESSED`

If the record is:

`PENDING_UPLOAD`

for an unusually long time:

- verify the client uploaded the object
- verify the object exists under `uploads/`
- verify the S3 event configuration
- check ProcessImageFunction invocation metrics

If the record is:

`PROCESSING`

for an unusually long time:

- inspect Lambda logs
- check Lambda timeout/error metrics

If the record is:

`FAILED`

- inspect ProcessImageFunction structured logs using the imageId

## S3 Diagnostics

### Source Object

Expected:

`uploads/{imageId}.{extension}`

If missing:

- the presigned upload may not have completed
- the client may have received an upload error

### Processed Object

Expected:

`processed/{imageId}.jpg`

If the source exists but the processed object does not:

1. check ProcessImageFunction invocation metrics
2. check Processor Errors
3. inspect processor logs
4. inspect DynamoDB status

If both source and processed objects exist but DynamoDB is not PROCESSED:

- investigate DynamoDB UpdateItem failure after S3 processing


## CloudFormation Deployment Failure

### Check Stack State

*powershell*
aws cloudformation describe-stacks \`
  --stack-name secure-image-api-dev \`
  --query "Stacks[0].StackStatus" \`
  --output text


This is real operational knowledge gained during the project rather than generic documentation.

---

# Phase 8.6.12 — Add a severity model

Keep this simple:

## Incident Severity

### SEV-1 — Critical

Examples:

- API unavailable for all requests
- repeated API 5XX failures
- infrastructure stack unrecoverable

### SEV-2 — High

Examples:

- image processing consistently failing
- persistent Lambda throttling
- many images stuck in PROCESSING or FAILED

### SEV-3 — Moderate

Examples:

- isolated processing failure
- single Lambda error
- individual malformed image

### SEV-4 — Informational

Examples:

- alarm recovered to OK
- isolated expected 400/401/403 response

## Recovery Verification

After resolving an incident:

1. Confirm affected CloudWatch alarm returns to `OK`.
2. Confirm Lambda Errors/Throttles stop increasing.
3. Run or observe the GitHub post-deployment E2E test.
4. Verify a new image reaches:

   `PENDING_UPLOAD → PROCESSING → PROCESSED`

5. Verify:
   - owner GET → 200
   - cross-user GET → 403
   - unauthenticated request → 401

6. Confirm no new ImageProcessingFailures metric is emitted.

## Security During Troubleshooting

Never place the following in logs, tickets, screenshots, or incident notes:

- Cognito passwords
- ID tokens
- access tokens
- refresh tokens
- Authorization headers
- AWS access keys
- AWS secret access keys
- AWS session tokens
- full S3 presigned URLs

Safe operational identifiers include:

- imageId
- Lambda requestId
- CloudFormation stack name
- Lambda function name
- CloudWatch alarm name
- S3 object key
