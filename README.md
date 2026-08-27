# Secure Event-Driven Image Processing API

A production-style serverless image-processing platform built on AWS that demonstrates secure API design, event-driven architecture, asynchronous processing, least-privilege IAM, CI/CD, automated end-to-end testing, and operational observability.

The system allows authenticated users to request a secure upload URL, upload an image directly to Amazon S3, automatically process the image through an event-driven Lambda workflow, and retrieve processing status through a protected REST API.

---

## Architecture Overview

```text
                         Amazon Cognito
                              │
                              ▼
Client ─────────────────→ API Gateway
                              │
                   ┌──────────┴───────────┐
                   │                      │
                   ▼                      ▼
         CreateUploadFunction       GetImageFunction
           Node.js / TypeScript      Node.js / TypeScript
                   │                      │
             ┌─────┴─────┐                │
             ▼           ▼                ▼
        DynamoDB     Presigned URL     DynamoDB
                         │
                         ▼
                    Amazon S3
                uploads/{imageId}.*
                         │
                  ObjectCreated
                         │
                         ▼
                ProcessImageFunction
                   Python / Pillow
                         │
                ┌────────┴────────┐
                ▼                 ▼
      processed/{imageId}.jpg   DynamoDB
                               PROCESSED
```

The platform is deployed through AWS SAM and CloudFormation and uses GitHub Actions with OIDC federation for secure automated deployments.

---

## Core Workflow

### 1. Authenticate
Users authenticate through Amazon Cognito and receive JWTs. API Gateway protects application endpoints using a Cognito authorizer.

- Missing/invalid JWT → `401`
- Authenticated owner → allowed
- Authenticated non-owner → `403`

### 2. Request an upload
The client calls:

```http
POST /images
```

Example request:

```json
{
  "fileName": "photo.png",
  "contentType": "image/png"
}
```

`CreateUploadFunction`:
- validates file metadata
- generates a UUID-based `imageId`
- creates an S3 object key under `uploads/`
- stores a `PENDING_UPLOAD` record in DynamoDB
- generates a short-lived S3 presigned PUT URL

### 3. Upload directly to S3
The client uploads the file directly to the private S3 bucket using the presigned URL.

### 4. Process asynchronously
An S3 `ObjectCreated` event for the `uploads/` prefix invokes `ProcessImageFunction`.

The processor:
- downloads the source image
- validates the actual decoded image type
- validates file size and image dimensions
- applies EXIF orientation
- converts images to RGB
- preserves aspect ratio while resizing
- prevents small images from being unnecessarily enlarged
- converts output to JPEG
- writes the result to `processed/{imageId}.jpg`

### 5. Track processing state
DynamoDB records the image lifecycle:

```text
PENDING_UPLOAD
      ↓
PROCESSING
      ↓
PROCESSED
```

Failures transition to `FAILED`.

### 6. Retrieve image status
Authenticated users call:

```http
GET /images/{imageId}
```

`GetImageFunction` enforces resource ownership by comparing the Cognito `sub` claim against the stored `userId`.

---

## Security Design

### API Security
- Amazon Cognito handles authentication
- API Gateway validates JWTs before invoking protected Lambdas
- Resource-level authorization ensures only the owner can access an image record

### S3 Security
- S3 bucket remains private
- Clients upload through short-lived presigned URLs
- Processor permissions are scoped separately:
  - read: `uploads/*`
  - write: `processed/*`
- The S3 trigger is filtered to `uploads/` to prevent recursive processing loops

### IAM Separation
CI/CD uses two roles:

```text
GitHub Actions
      │ OIDC
      ▼
SecureImageApiGitHubDeployRole
      │ iam:PassRole
      ▼
SecureImageApiCloudFormationRole
      ▼
CloudFormation-managed resources
```

No long-lived AWS access keys are stored in GitHub.

---

## Technology Stack

| Area | Technology |
|---|---|
| API | Amazon API Gateway REST API |
| Authentication | Amazon Cognito |
| API runtime | Node.js 22 + TypeScript |
| Image processing | Python 3.12 + Pillow |
| Object storage | Amazon S3 |
| State persistence | Amazon DynamoDB |
| IaC | AWS SAM + CloudFormation |
| Node build | esbuild |
| Node testing | Vitest |
| Python testing | pytest |
| CI/CD | GitHub Actions |
| AWS authentication | GitHub OIDC |
| Logging | CloudWatch structured JSON logs |
| Metrics | CloudWatch native + custom EMF |
| Alerting | CloudWatch Alarms + Amazon SNS |
| Tracing | AWS X-Ray |
| Operations | CloudWatch Dashboard + incident runbook |

---

## Automated Testing

### Unit Tests
**Vitest** covers Node functions:
- supported MIME types
- file-extension mapping
- Cognito `sub` extraction
- ownership logic
- request validation

**pytest** covers the Python processor:
- valid image transformation
- resizing large images
- maintaining aspect ratio
- avoiding enlargement of small images
- invalid-image rejection
- observability helper contracts
- trace-ID extraction

### Infrastructure Validation
Every CI run performs:

```text
sam validate
sam validate --lint
sam build --use-container
```

### Post-Deployment E2E Tests
After deployment, GitHub Actions validates the real environment end-to-end:
- unauthenticated request → `401`
- Cognito authentication
- `POST /images`
- generate a test PNG
- upload to S3 using a presigned URL
- trigger S3 event processing
- poll DynamoDB-backed status until `PROCESSED`
- owner access → `200`
- cross-user access → `403`

---

## CI/CD Pipeline

### Pull Requests
```text
Pull Request → main
      ↓
Unit tests
TypeScript build
SAM validation
      ↓
No AWS deployment
```

### Main Branch
```text
Push / merge → main
      ↓
CI quality gates
      ↓
GitHub OIDC
      ↓
Temporary AWS credentials
      ↓
SAM build
      ↓
CloudFormation deployment
      ↓
Log-retention configuration
      ↓
Post-deployment E2E tests
```

Deployment is blocked automatically if tests or validation fail.

---

## Observability and Operations

### Structured Logging
All Lambda functions use structured JSON logging with fields such as:
- `service`
- `requestId`
- `traceId`
- `imageId`
- `stage`
- `status`
- `errorType`

Sensitive values such as JWTs, passwords, AWS credentials, and presigned URLs are intentionally excluded.

### Metrics
Native CloudWatch metrics:
- Lambda `Invocations`, `Errors`, `Throttles`, `Duration`
- API Gateway `Count`, `4XXError`, `5XXError`, `Latency`, `IntegrationLatency`

Custom EMF metric:
- `SecureImageApi / ImageProcessingFailures`
- dimension: `Service=process-image`

### Alarms
CloudWatch alarms monitor:
- processor Lambda errors
- processor Lambda throttles
- API Gateway 5XX errors
- custom image processing failures

### Notifications
Alarm state changes publish to SNS and notify an operator email address.

### Dashboard
A CloudWatch dashboard provides a single view for:
- alarm status
- API request volume
- API 5XX errors
- processor invocations
- processor errors and throttles
- processor duration
- application-level processing failures

### Distributed Tracing
AWS X-Ray tracing is enabled for:
- API Gateway
- `CreateUploadFunction`
- `GetImageFunction`
- `ProcessImageFunction`

Because image processing crosses an asynchronous S3 boundary, `imageId` serves as the durable business correlation key across traces.

### Runbook
The repository includes `docs/OPERATIONS.md` with:
- failure diagnostics
- Logs Insights queries
- DynamoDB and S3 troubleshooting
- CloudFormation recovery steps
- incident severity guidelines
- recovery verification steps

---

## Significant Engineering Challenges

### 1. CloudFormation dependency cycle
**Problem:** S3 events, Lambda permissions, and resource references created circular dependencies.

**Fix:** Reduced unnecessary `Ref`/`GetAtt` usage and adjusted resource relationships to preserve trigger wiring without cyclic infrastructure dependencies.

### 2. Sharp deployment packaging
**Problem:** Node.js + Sharp created repeated packaging friction in SAM.

**Fix:** Converted only the image-processing workload to Python 3.12 + Pillow while keeping API functions in Node.js/TypeScript.

### 3. SAM/esbuild build failures
**Problem:** SAM repeatedly failed to resolve `esbuild`.

**Fix:** Moved TypeScript compilation outside SAM and packaged prebuilt `dist/handler.js` artifacts.

### 4. Lambda handler resolution error
**Problem:** Lambda reported `Cannot find module 'handler'`.

**Fix:** Aligned `CodeUri`, handler configuration, and compiled output structure.

### 5. GitHub OIDC authorization failure
**Problem:** AWS rejected the GitHub OIDC token.

**Fix:** Corrected IAM trust-policy conditions to match GitHub's actual `sub` claim for the repository and branch.

### 6. SAM artifact bucket permission issues
**Problem:** GitHub could upload artifacts, but CloudFormation could not read them.

**Fix:** Granted the CloudFormation execution role narrowly scoped `s3:GetObject` access to the deployment artifact prefix.

### 7. CloudFormation rollback failure
**Problem:** The stack entered `UPDATE_ROLLBACK_FAILED`.

**Fix:** Repaired IAM permissions, used `continue-update-rollback`, then redeployed after the stack returned to a healthy state.

### 8. E2E request contract mismatch
**Problem:** The integration test sent only `contentType`, but the API required both `fileName` and `contentType`.

**Fix:** Updated the E2E test payload to match the real API contract.

### 9. Runtime processing bug
**Problem:** The processor moved items to `FAILED`; logs revealed `AttributeError: 'dict' object has no attribute 'bytes'`.

**Fix:** Corrected dictionary access in the Python orchestration logic and added regression coverage.

### 10. Existing log groups collided with IaC
**Problem:** CloudFormation could not create log groups that Lambda had already created.

**Fix:** Managed retention post-deployment via `logs:PutRetentionPolicy` instead of forcing new CloudFormation ownership.

---

## Key Design Decisions

1. **Presigned S3 uploads** instead of proxying files through Lambda
2. **Event-driven processing** via S3 notifications
3. **DynamoDB state tracking** for the asynchronous workflow
4. **Cognito ownership binding** for resource-level authorization
5. **Polyglot serverless design**: TypeScript for APIs, Python/Pillow for image processing
6. **GitHub OIDC** instead of long-lived AWS keys
7. **Separate deployment and execution roles** for least privilege
8. **Post-deployment E2E validation** of the real environment
9. **Structured logs + metrics + traces** for observability
10. **Runbook-driven operations** for incident response

---

## What This Project Demonstrates

This project demonstrates practical experience with:

- REST API design
- JWT authentication and authorization
- event-driven serverless architecture
- asynchronous processing patterns
- S3, Lambda, DynamoDB, API Gateway, Cognito
- Infrastructure as Code with AWS SAM/CloudFormation
- least-privilege IAM design
- GitHub Actions CI/CD with AWS OIDC
- unit, integration, and end-to-end testing
- CloudWatch logs, metrics, alarms, dashboards, and SNS notifications
- operational hardening and incident response
- distributed tracing with AWS X-Ray

---

## Repository Companion Docs

- `docs/OPERATIONS.md` — operational runbook and incident diagnostics
- `README.md` — project case study and implementation summary



