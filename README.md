## Local Quality Checks

Install Node dependencies:
npm run install:node

Run node unit tests:
npm run test

Run Python unit tests:
python -m pytest src/functions/process-image/tests -v

Build TypeScript Lambdas:
npm run build

Validate Infrastructure:
sam validate 
sam validate --lint

Build SAM application:
sam build --use-container

## Operations and Observability

The application includes production-style observability and operational tooling:

- structured JSON Lambda logging
- correlation using image and request IDs
- CloudWatch Logs Insights queries
- managed log retention
- Lambda/API Gateway native metrics
- custom image-processing failure metrics
- CloudWatch alarms
- SNS alarm notifications
- operational CloudWatch dashboard
- incident-response runbook

See [Operational Runbook](docs/OPERATIONS.md).