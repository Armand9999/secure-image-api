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
